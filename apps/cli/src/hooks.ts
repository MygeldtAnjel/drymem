/**
 * Claude Code session hooks, as client subcommands.
 *
 * These replace the bash + Python scripts: one runtime, one config, and the
 * hook payload is read from stdin exactly as Claude Code sends it.
 *
 * A hook must never break a session. Every path here exits 0, and anything
 * useful goes to stderr where the user can see it without corrupting stdout.
 */

import { DrymemClient } from "./client.js";
import { loadConfig } from "./config.js";
import { resolveProjectKey } from "./identity.js";

const MEMORY_PROTOCOL = `<drymem-memory-protocol>
You have access to drymem MCP tools for persistent memory. Follow these rules:

RULE 1 — SESSION START: Memory context for this project has been loaded above. Use it silently to inform your work without announcing it.

RULE 2 — PROACTIVE RETRIEVAL: Before starting any task, silently call mem_search with 1-2 SHORT keywords from the user's request.

RULE 3 — PROACTIVE SAVING: Call mem_finalize_session silently after completing meaningful work (bug fixed, feature added, decision made). Do NOT wait for the user to ask. Do NOT announce that you are saving.

RULE 4 — WHEN SAVING: Use mem_finalize_session with a clear topic_key (e.g. "auth/jwt-setup"), a type (decision | architecture | bugfix | discovery | convention | note), and a body under these headings: ## Summary, ## Why, ## Where, ## Key details, ## Learned.

RULE 5 — SEARCH TIPS: Use single short keywords. "test" not "test structure testing".

RULE 6 — AFTER COMPACTION: Immediately call mem_context to recover recent session history, then continue.
</drymem-memory-protocol>`;

const COMPACTION_PROTOCOL = `<drymem-post-compaction>
IMPORTANT: Your context was just compacted. Follow these steps before continuing:

1. Call mem_finalize_session to save a summary of what was accomplished before compaction.
2. Call mem_context to reload recent project memory.
3. Only then resume the user's task.
</drymem-post-compaction>`;

export interface HookPayload {
  cwd?: string;
  session_id?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  hook_event_name?: string;
}

const MIN_SUMMARY = 50;
const MAX_SUMMARY = 3000;

export async function readPayload(stream: NodeJS.ReadableStream = process.stdin): Promise<HookPayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as HookPayload) : {};
  } catch {
    return {};
  }
}

async function recentContext(cwd: string): Promise<string> {
  const config = loadConfig();
  if (!config) return "";
  try {
    const episodes = await new DrymemClient(config).context(resolveProjectKey(cwd), 5);
    return episodes
      .map((e) => {
        const who = e.author ? ` · ${e.author}` : "";
        const when = (e.created_at ?? "").slice(0, 16).replace("T", " ");
        return `### ${e.name} (${when}${who})\n${e.content.slice(0, 300)}\n`;
      })
      .join("\n");
  } catch {
    // A cold or unreachable server must not stop the session from starting.
    return "";
  }
}

async function injectContext(payload: HookPayload, protocol: string): Promise<void> {
  const cwd = payload.cwd ?? process.cwd();
  console.log(protocol);

  const context = await recentContext(cwd);
  if (context) {
    console.log(`\n<drymem-context project="${resolveProjectKey(cwd)}">`);
    console.log(context);
    console.log("</drymem-context>");
  }
}

export async function sessionStart(payload: HookPayload): Promise<void> {
  // Two independent jobs, and neither may take the other down with it. The
  // context is what the agent reads; the skills are what it can do. A hook
  // that throws stops the session it runs in, so both are wrapped.
  await Promise.allSettled([injectContext(payload, MEMORY_PROTOCOL), syncSkills(payload)]);
}

/**
 * Install whatever this project has enabled, quietly.
 *
 * This is the whole "the lead adds a skill, everyone else runs `git pull`"
 * promise, and it lives here because a person should never have to remember a
 * command for it. It says nothing on success: a hook that prints on every
 * session start becomes noise people learn to scroll past.
 */
async function syncSkills(payload: HookPayload): Promise<void> {
  try {
    const { pull } = await import("./catalogue.js");
    const { DrymemClient } = await import("./client.js");
    const { loadConfig } = await import("./config.js");
    const { resolveProjectKey } = await import("./identity.js");

    const config = loadConfig();
    if (!config) return;
    const root = payload.cwd ?? process.cwd();
    const result = await pull(new DrymemClient(config), resolveProjectKey(root), root, []);

    const changed = result.results.flatMap((r) => [...r.installed, ...r.removed]);
    if (changed.length > 0) {
      console.error(`drymem: skills updated (${changed.join(", ")})`);
    }
  } catch (error) {
    // Never a reason to interrupt somebody's session.
    console.error(`drymem: could not sync skills (${String(error).slice(0, 120)})`);
  }
}

export async function postCompaction(payload: HookPayload): Promise<void> {
  await injectContext(payload, COMPACTION_PROTOCOL);
}

/**
 * Autosave: only when the agent did not save for itself.
 *
 * `last_assistant_message` is in the payload, so nothing needs to be parsed out
 * of a transcript to know what was said.
 */
export async function sessionStop(payload: HookPayload): Promise<void> {
  const config = loadConfig();
  if (!config) return;

  const alreadySaved = await agentSaved(payload.transcript_path);
  if (alreadySaved) {
    console.error("drymem: agent already saved");
    return;
  }

  let summary = (payload.last_assistant_message ?? "").trim();
  if (summary.length < MIN_SUMMARY) {
    console.error("drymem: nothing substantial to save");
    return;
  }
  if (summary.length > MAX_SUMMARY) summary = `${summary.slice(0, MAX_SUMMARY)}\n...(truncated)`;

  const cwd = payload.cwd ?? process.cwd();
  const session = (payload.session_id ?? "unknown").slice(0, 8);
  try {
    const result = await new DrymemClient(config).save({
      project_key: resolveProjectKey(cwd),
      summary: `## Auto-saved session summary\n\nThe agent did not call \`mem_finalize_session\`, so this is what it last said.\n\n${summary}`,
      topic_key: `autosave-${session}`,
    });
    console.error(`drymem: autosaved ${result.episode_uuid}`);
  } catch (error) {
    console.error(`drymem: autosave failed (${error})`);
  }
}

export async function subagentStop(payload: HookPayload): Promise<void> {
  const last = payload.last_assistant_message ?? "";
  if (/^#+ *(key learnings|learnings|findings)/im.test(last)) {
    console.error("[drymem] Subagent reported findings. Persist them with mem_finalize_session.");
  }
}

/** Did this session already call mem_finalize_session? */
async function agentSaved(transcriptPath: string | undefined): Promise<boolean> {
  if (!transcriptPath) return false;
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return false;
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: { message?: { role?: string; content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a live transcript's last line is often half-written
    }
    const content = entry.message?.content;
    if (entry.message?.role !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      const name = (block as { type?: string; name?: string }).name;
      if (
        (block as { type?: string }).type === "tool_use" &&
        typeof name === "string" &&
        // MCP tools appear fully qualified: mcp__drymem__mem_finalize_session
        (name === "mem_finalize_session" || name.endsWith("__mem_finalize_session"))
      ) {
        return true;
      }
    }
  }
  return false;
}

export const HOOKS = {
  "session-start": sessionStart,
  "post-compaction": postCompaction,
  "session-stop": sessionStop,
  "subagent-stop": subagentStop,
} as const;

export type HookName = keyof typeof HOOKS;
