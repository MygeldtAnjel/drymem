#!/usr/bin/env /usr/bin/node
/**
 * drymem autosave — called by the Stop hook after each assistant turn.
 * Usage: autosave.mjs <project_path> <transcript_path> <session_id>
 *
 * Strategy:
 *   1. If ANTHROPIC_API_KEY is set → call Haiku for a rich LLM summary.
 *   2. Otherwise → extract a heuristic summary directly from the transcript.
 *
 * Silently exits 0 on any error so it never blocks Claude Code.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync, existsSync } from "fs";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

const DRYMEM_DIR = process.env.DRYMEM_DIR ?? resolve(__dirname, "../../..");
const DB_PATH    = process.env.DRYMEM_DB_PATH ?? resolve(DRYMEM_DIR, "drymem.sqlite");

const projectPath    = process.argv[2];
const transcriptPath = process.argv[3];
const sessionId      = process.argv[4];

if (!projectPath || !transcriptPath || !sessionId || !existsSync(transcriptPath)) {
  process.exit(0);
}

// ── Parse transcript ────────────────────────────────────────────────────────

const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
const events = [];
for (const line of lines) {
  try { events.push(JSON.parse(line)); } catch { /* skip */ }
}

// Only proceed if tools were actually used (meaningful work happened)
const hasTools = events.some(e => {
  const content = e?.message?.content;
  return Array.isArray(content) && content.some(b => b?.type === "tool_use");
});
if (!hasTools) process.exit(0);

// ── Noise filtering ──────────────────────────────────────────────────────────

/**
 * Strip XML-like tag blocks injected by the IDE or system
 * (e.g. <ide_opened_file>...</ide_opened_file>, <system-reminder>...</system-reminder>)
 * and return clean text. Returns empty string if nothing real remains.
 */
function cleanText(text) {
  return text
    .replace(/<[a-zA-Z_-]+>[\s\S]*?<\/[a-zA-Z_-]+>/g, "")  // remove tag blocks
    .replace(/<[a-zA-Z_-]+\s*\/>/g, "")                       // remove self-closing tags
    .replace(/\s+/g, " ")
    .trim();
}

// Extract structured data from transcript
const userMessages   = [];
const bashCmds       = [];
const filesEdited    = new Set();
const filesWritten   = new Set();
const assistantTexts = [];

for (const event of events) {
  const msg = event?.message;
  if (!msg) continue;
  const { role, content } = msg;
  if (!Array.isArray(content)) continue;

  if (role === "user") {
    for (const block of content) {
      if (block?.type === "text") {
        const clean = cleanText(block.text ?? "");
        if (clean.length > 10) userMessages.push(clean);  // skip short/empty noise
      }
    }
  } else if (role === "assistant") {
    for (const block of content) {
      if (block?.type === "text" && block.text?.trim()) {
        assistantTexts.push(block.text.trim());
      } else if (block?.type === "tool_use") {
        const { name, input = {} } = block;
        if (name === "Bash" && input.command) {
          bashCmds.push(String(input.command).slice(0, 120).replace(/\n/g, " "));
        } else if (name === "Edit"  && input.file_path) filesEdited.add(input.file_path);
        else if (name === "Write" && input.file_path) filesWritten.add(input.file_path);
      }
    }
  }
}

// Skip if there's no real user message (pure IDE event session)
if (userMessages.length === 0) {
  process.stderr.write("[drymem] skipping: no real user messages found\n");
  process.exit(0);
}

// ── Heuristic topic key ──────────────────────────────────────────────────────

/**
 * Try to infer a meaningful category/slug from what actually happened,
 * rather than falling back to session/date-id.
 *
 * Priority:
 *   1. Category from the most-edited file path
 *   2. Category from bash commands (git, npm, test, fix, setup, etc.)
 *   3. Slug from the first user message words
 *   4. Fallback: session/short-id
 */
function inferTopicKey(sessionShort) {
  // 1. From files changed
  const allFiles = [...filesEdited, ...filesWritten];
  if (allFiles.length > 0) {
    const f = allFiles[0];
    // Extract middle path segment as category (e.g. src/auth/foo.ts → auth)
    const parts = f.replace(projectPath, "").replace(/^\//, "").split("/");
    const meaningful = parts.filter(p => !["src", "lib", "dist", ".", ".."].includes(p));
    if (meaningful.length >= 2) {
      const category = meaningful[0];
      const name = meaningful[meaningful.length - 1].replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      return `${category}/${name}`.slice(0, 60);
    }
  }

  // 2. From bash commands
  const cmdStr = bashCmds.join(" ").toLowerCase();
  if (cmdStr.includes("git commit") || cmdStr.includes("git push")) return `git/commit-${sessionShort}`;
  if (cmdStr.includes("npm test") || cmdStr.includes("jest") || cmdStr.includes("vitest")) return `test/run-${sessionShort}`;
  if (cmdStr.includes("npm install") || cmdStr.includes("npm i ")) return `deps/install-${sessionShort}`;
  if (cmdStr.includes("setup") || cmdStr.includes("install")) return `setup/${sessionShort}`;
  if (cmdStr.includes("fix") || cmdStr.includes("bug")) return `fix/${sessionShort}`;
  if (cmdStr.includes("migrate") || cmdStr.includes("migration")) return `db/migration-${sessionShort}`;

  // 3. From first user message — take first 4 significant words
  const words = userMessages[0]
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 4);
  if (words.length >= 2) {
    return `session/${words.slice(0, 2).join("-")}-${sessionShort}`;
  }

  return `session/${sessionShort}`;
}

// ── Build heuristic summary ──────────────────────────────────────────────────

function heuristicSummary() {
  const sessionShort = sessionId.slice(0, 8);
  const topic_key    = inferTopicKey(sessionShort);

  const problem_statement = userMessages[0].slice(0, 300);

  const actionLines = [];
  for (const cmd of bashCmds.slice(0, 10)) actionLines.push(`- ran: \`${cmd}\``);
  for (const f of filesEdited)  actionLines.push(`- edited: ${f}`);
  for (const f of filesWritten) actionLines.push(`- wrote: ${f}`);
  const solution_summary = actionLines.length
    ? actionLines.join("\n")
    : "No file changes detected.";

  const allChanged = [...filesEdited, ...filesWritten];
  const affected_files = allChanged.length ? allChanged.join(", ") : "none";

  const lastAssistant = assistantTexts[assistantTexts.length - 1]?.slice(0, 400) ?? "";
  const key_learnings = lastAssistant || "See solution summary above.";

  return { topic_key, problem_statement, solution_summary, affected_files, key_learnings };
}

// ── Optionally use Anthropic API for a richer summary ───────────────────────

const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

async function llmSummary() {
  const conversation = [];
  for (const event of events) {
    const msg = event?.message;
    if (!msg) continue;
    const { role, content } = msg;
    if (!Array.isArray(content)) continue;

    if (role === "user") {
      for (const block of content) {
        if (block?.type === "text") {
          const clean = cleanText(block.text ?? "");
          if (clean) conversation.push(`[user]: ${clean.slice(0, 300)}`);
        }
      }
    } else if (role === "assistant") {
      const parts = [];
      for (const block of content) {
        if (block?.type === "text") parts.push(block.text.slice(0, 200));
        else if (block?.type === "tool_use") {
          const { name, input = {} } = block;
          if (name === "Bash")       parts.push(`[bash: ${String(input.command ?? "").slice(0, 80)}]`);
          else if (name === "Edit")  parts.push(`[edited: ${input.file_path ?? ""}]`);
          else if (name === "Write") parts.push(`[wrote: ${input.file_path ?? ""}]`);
        }
      }
      if (parts.length) conversation.push(`[assistant]: ${parts.join(" | ").slice(0, 400)}`);
    }
  }

  const recent = conversation.slice(-40).join("\n\n");
  const prompt = `Summarize this AI coding session for a developer memory system.

Session transcript:
${recent}

Rules:
- topic_key must be "category/short-description" (e.g. "auth/jwt-refresh-fix", "db/migration-setup", "hooks/autosave-noise-filter")
- If no meaningful coding work occurred (e.g. user only opened a file, no real task), respond with: {"skip":true}
- problem_statement: the actual user request, 1-2 sentences max
- solution_summary: what was done and how, concise
- key_learnings: specific technical insight, gotcha, or decision — NOT a restatement of the summary

Respond with ONLY valid JSON, no markdown fences:
{"topic_key":"category/short-description","problem_statement":"...","solution_summary":"...","affected_files":"...","key_learnings":"..."}`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.content?.[0]?.text?.trim();
          if (!text) return reject(new Error("empty response"));
          const summary = JSON.parse(text);
          resolve(summary);
        } catch { reject(new Error("parse error")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

try {
  let summary;

  if (API_KEY) {
    try {
      summary = await llmSummary();
      if (summary?.skip) {
        process.stderr.write("[drymem] skipping: LLM determined no meaningful work\n");
        process.exit(0);
      }
    } catch {
      summary = heuristicSummary();
    }
  } else {
    summary = heuristicSummary();
  }

  const { topic_key, problem_statement, solution_summary, affected_files, key_learnings } = summary;
  if (!topic_key || !problem_statement) process.exit(0);

  const sessionShort  = sessionId.slice(0, 8);
  // Derive a short title from the topic_key (e.g. "scripts/autosave" → "scripts/autosave")
  const title = topic_key.replace(/\/as-[a-f0-9]+$/, "").slice(0, 100);
  const finalTopicKey = topic_key.includes(`/as-${sessionShort}`)
    ? topic_key
    : topic_key.endsWith(`-${sessionShort}`)
      ? topic_key           // heuristic already has it
      : `${topic_key}/as-${sessionShort}`;

  const content = `# Session Summary: ${topic_key}

## Problem Statement
${problem_statement}

## Solution Summary
${solution_summary}

## Affected Files
${affected_files}

## Key Learnings
${key_learnings}

---
*Auto-saved by drymem Stop hook (session: ${sessionShort})*`;

  // ── Write to SQLite (schema v2) ────────────────────────────────────────────
  const { createHash } = await import("crypto");
  const normalizedHash = createHash("sha256")
    .update(content.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");

  const Database = require(resolve(DRYMEM_DIR, "node_modules/better-sqlite3"));
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Topic key upsert: update if exists, else insert
  const existing = db.prepare(`
    SELECT id FROM observations
    WHERE topic_key = ? AND project_path = ? AND scope = 'project' AND deleted_at IS NULL
    ORDER BY updated_at DESC LIMIT 1
  `).get(finalTopicKey, projectPath);

  if (existing) {
    db.prepare(`
      UPDATE observations SET
        title           = ?,
        content         = ?,
        normalized_hash = ?,
        revision_count  = revision_count + 1,
        last_seen_at    = datetime('now', 'localtime'),
        updated_at      = datetime('now', 'localtime')
      WHERE id = ?
    `).run(title, content, normalizedHash, existing.id);
  } else {
    db.prepare(`
      INSERT INTO observations
        (session_id, type, title, content, tool_name, project_path, scope, topic_key, normalized_hash)
      VALUES ('', 'session_summary', ?, ?, '', ?, 'project', ?, ?)
    `).run(title, content, projectPath, finalTopicKey, normalizedHash);
  }

  db.close();
  process.stderr.write(`[drymem] auto-saved: ${finalTopicKey}\n`);
} catch (err) {
  process.stderr.write(`[drymem] autosave error: ${err.message}\n`);
  process.exit(0);
}
