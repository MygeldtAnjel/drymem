/**
 * The MCP surface: five tools over stdio, forwarded to the server.
 *
 * Names, arguments and descriptions match what `drymem_server/server.py`
 * exposed before the split, because the memory protocol every agent already
 * follows names these tools. Changing them would mean rewriting every team's
 * instructions; the transport changing underneath is nobody else's business.
 *
 * `project_path` stays the argument (not `project_key`) for the same reason:
 * the agent knows its working directory, and turning that into a project
 * identity is the client's job.
 */

import { randomBytes } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { DrymemClient, DrymemError } from "./client.js";
import { requireConfig } from "./config.js";
import { resolveProjectKey } from "./identity.js";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * The sitting this server process belongs to.
 *
 * One MCP process is started per agent run, so the process *is* the session —
 * which is the only reliable source for it. Asking the agent to pass its own
 * session id sounds cleaner and does not work: most agents do not know theirs,
 * and one that guesses is worse than one that says nothing. An explicit
 * `session_id` argument still wins when a caller genuinely has one.
 */
const SESSION_ID = `s-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${randomBytes(3).toString("hex")}`;

/** What a well-written memory says. Kept in one string so every tool quotes it identically. */
const SHAPE =
  "Markdown body. Structure it with these headings so a teammate can scan it: " +
  "## Summary (what happened, two lines) · ## Why (what forced it) · " +
  "## Where (files, services, commands) · ## Key details (the specifics worth keeping) · " +
  "## Learned (what you now know that you did not). Prose still works; the headings make it scannable.";

const TYPE_HELP =
  "What kind of memory this is: decision · architecture · bugfix · discovery · convention · note. " +
  "Defaults to note; an unknown value is not an error.";

function text(body: string, isError = false): TextResult {
  return { content: [{ type: "text", text: body }], isError };
}

/**
 * Tool errors are returned, never thrown.
 *
 * A thrown error inside an MCP tool surfaces to the agent as a protocol
 * failure; a returned one is something it can read and act on. "The server is
 * unreachable" is information the agent should relay, not a crash.
 */
async function guard(work: () => Promise<TextResult>): Promise<TextResult> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof DrymemError ? error.message : String(error);
    return text(`drymem: ${message}`, true);
  }
}

function formatDate(value: string | null): string {
  if (!value) return "?";
  return value.slice(0, 16).replace("T", " ");
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "drymem", version: "2.1.0" });
  const client = () => new DrymemClient(requireConfig());

  server.tool(
    "mem_finalize_session",
    "Save a structured session summary as a knowledge-graph episode.",
    {
      project_path: z.string().describe("Absolute path of the project (used for isolation)."),
      summary: z.string().describe(SHAPE),
      topic_key: z
        .string()
        .optional()
        .describe("Optional stable key like 'auth/jwt-setup' for cross-session linking."),
      type: z.string().optional().describe(TYPE_HELP),
      session_id: z
        .string()
        .optional()
        .describe("The agent run this came out of. Defaults to this session."),
    },
    async ({ project_path, summary, topic_key, type, session_id }) =>
      guard(async () => {
        const result = await client().save({
          project_key: resolveProjectKey(project_path),
          summary,
          topic_key: topic_key ?? "",
          type: type ?? "note",
          session_id: session_id ?? SESSION_ID,
        });

        const lines = [
          `Session finalized: '${result.name}'`,
          `  project: ${result.project_key}`,
          `  author: ${result.author}`,
          `  entities extracted: ${result.entity_count}`,
          `  relationships extracted: ${result.relationship_count}`,
          `  episode_id: ${result.episode_uuid}`,
        ];
        // Surfacing these matters: a redaction means someone pasted a secret,
        // and a degraded save means the graph is missing edges for this memory.
        if (result.scrubbed) lines.push(`  ${result.scrubbed}`);
        if (result.degraded) lines.push(`  WARNING: extraction failed (${result.degraded})`);
        return text(lines.join("\n"));
      }),
  );

  server.tool(
    "mem_search",
    "Search the knowledge graph for memories matching a query.",
    {
      project_path: z.string().describe("Absolute path of the project (used for isolation)."),
      query: z.string().describe("Short keyword or phrase to search for."),
      num_results: z.number().int().min(1).max(100).optional().describe("Max results (default 10)."),
    },
    async ({ project_path, query, num_results }) =>
      guard(async () => {
        const { memories, facts } = await client().search(
          resolveProjectKey(project_path),
          query,
          num_results ?? 10,
        );
        if (memories.length === 0 && facts.length === 0) {
          return text("No memories found.");
        }

        // The agent gets the memories, which it can read and cite. The facts
        // are appended as corroboration, not as the answer.
        const lines = memories.map(
          (m) =>
            `- ${m.title || m.name} (${m.type}, ${m.author ?? "unknown"}, ` +
            `${formatDate(m.created_at)}) [${m.uuid}]`,
        );
        if (facts.length > 0) {
          lines.push("", `Related facts (${facts.length}):`);
          for (const f of facts.slice(0, 8)) {
            lines.push(`  - ${f.fact}${f.superseded ? " [superseded]" : ""}`);
          }
        }
        return text(`Found ${memories.length} memory(ies):\n${lines.join("\n")}`);
      }),
  );

  server.tool(
    "mem_context",
    "Retrieve the most recent episodes and graph state for a project.",
    {
      project_path: z.string().describe("Absolute path of the project (used for isolation)."),
      last_n: z.number().int().min(1).max(100).optional().describe("How many (default 10)."),
    },
    async ({ project_path, last_n }) =>
      guard(async () => {
        const episodes = await client().context(resolveProjectKey(project_path), last_n ?? 10);
        if (episodes.length === 0) return text("No recent context.");

        const blocks = episodes.map((e) => {
          const facts = [e.type, e.author, formatDate(e.created_at)];
          if (e.scope === "team") facts.push("shared");
          return `### ${e.title || e.name}\n${facts.filter(Boolean).join(" · ")}\n${e.content.slice(0, 300)}\n`;
        });
        return text(`Recent context (${episodes.length} episodes):\n\n${blocks.join("\n")}`);
      }),
  );

  server.tool(
    "mem_update",
    "Update an existing memory episode by topic_key. Appends by default; pass replace=true to delete the old episode(s) first.",
    {
      project_path: z.string().describe("Absolute path of the project (used for isolation)."),
      topic_key: z.string().describe("The stable key used when the episode was first saved."),
      update_summary: z.string().describe(`What changed, bug found, fix applied. ${SHAPE}`),
      replace: z.boolean().optional().describe("Delete old episode(s) first. Default false."),
      type: z.string().optional().describe(TYPE_HELP),
    },
    async ({ project_path, topic_key, update_summary, replace, type }) =>
      guard(async () => {
        const result = await client().update(topic_key, {
          project_key: resolveProjectKey(project_path),
          update_summary,
          replace: replace ?? false,
          type: type ?? "note",
          session_id: SESSION_ID,
        });

        const lines = [
          `Memory updated (${replace ? "replaced" : "appended"}): '${result.name}'`,
          `  project: ${result.project_key}`,
          `  entities extracted: ${result.entity_count}`,
          `  relationships extracted: ${result.relationship_count}`,
          `  episode_id: ${result.episode_uuid}`,
        ];
        if (result.scrubbed) lines.push(`  ${result.scrubbed}`);
        return text(lines.join("\n"));
      }),
  );

  server.tool(
    "mem_delete",
    "Delete an episode from the knowledge graph.",
    {
      project_path: z.string().describe("Absolute path of the project (used for isolation)."),
      episode_id: z.string().describe("UUID of the episode to delete."),
    },
    async ({ episode_id }) =>
      guard(async () => {
        await client().delete(episode_id);
        return text(`Episode ${episode_id} deleted.`);
      }),
  );

  return server;
}

/**
 * Serve MCP over stdio until the client disconnects.
 *
 * `connect()` resolves as soon as the transport is wired up, not when the
 * session ends. Returning at that point lets the caller exit and kills the
 * server before it answers anything, so this waits for the transport to close.
 */
export async function runMcp(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.once("end", () => resolve());
    process.stdin.once("close", () => resolve());
  });

  await server.connect(transport);
  await closed;
}
