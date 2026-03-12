import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  SaveMemoryUseCase,
  SearchMemoriesUseCase,
  GetContextUseCase,
  DeleteMemoryUseCase,
  SessionUseCase,
  SuggestTopicKeyUseCase,
} from "../../core/use-cases/memory-use-cases.js";
import { runMigrations } from "../../infrastructure/database/migrations.js";

console.log = console.error;
console.info = console.error;

runMigrations();

const server = new Server(
  { name: "drymem-agent", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

const currentProjectPath = process.cwd();

function projectPath(args: any): string {
  return args?.project_path || currentProjectPath;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mem_save",
      description: "Save an observation to persistent memory. Call immediately after: decisions made, bugs fixed, patterns discovered, gotchas found, or user preferences learned.",
      inputSchema: {
        type: "object",
        properties: {
          title:        { type: "string",  description: "Short searchable title (e.g. 'JWT refresh token must be rotated on use')" },
          content:      { type: "string",  description: "Full content — What happened, Why it matters, Where it applies, what was Learned" },
          type:         { type: "string",  description: "Category: decision | architecture | bugfix | pattern | config | discovery | learning | session_summary | manual", default: "manual" },
          topic_key:    { type: "string",  description: "Stable upsert key for evolving topics (e.g. 'auth/jwt-strategy'). Reusing the same key updates the existing entry." },
          session_id:   { type: "string",  description: "Current session ID" },
          project_path: { type: "string" },
          scope:        { type: "string",  description: "project (default) | personal" },
        },
        required: ["title", "content"],
      },
    },
    {
      name: "mem_search",
      description: "Search persistent memory by keywords. Use before starting work on anything that may have been done before.",
      inputSchema: {
        type: "object",
        properties: {
          keyword:      { type: "string" },
          type:         { type: "string", description: "Filter by type: decision | architecture | bugfix | pattern | config | discovery | learning | session_summary" },
          project_path: { type: "string" },
          scope:        { type: "string" },
          limit:        { type: "number", description: "Max results (default 10, max 20)" },
        },
        required: ["keyword"],
      },
    },
    {
      name: "mem_context",
      description: "Get recent memory context — sessions and observations — for this project. Called automatically at session start.",
      inputSchema: {
        type: "object",
        properties: {
          project_path: { type: "string" },
          limit:        { type: "number", description: "Number of observations to return (default 20)" },
        },
      },
    },
    {
      name: "mem_delete",
      description: "Soft-delete an observation by its numeric ID (get IDs from mem_search results).",
      inputSchema: {
        type: "object",
        properties: {
          id:           { type: "number" },
          project_path: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "mem_finalize_session",
      description: "Save a comprehensive end-of-session summary. Call before ending any significant session.",
      inputSchema: {
        type: "object",
        properties: {
          topic_key:         { type: "string", description: "e.g. 'session/2026-03-12-auth-refactor'" },
          project_path:      { type: "string" },
          session_id:        { type: "string" },
          problem_statement: { type: "string", description: "What the user asked / what was worked on" },
          solution_summary:  { type: "string", description: "What was done and how" },
          affected_files:    { type: "string", description: "Comma-separated file paths changed" },
          key_learnings:     { type: "string", description: "Specific technical insight, gotcha, or decision" },
        },
        required: ["topic_key", "problem_statement", "solution_summary", "affected_files", "key_learnings"],
      },
    },
    {
      name: "mem_suggest_topic_key",
      description: "Suggest a stable topic_key for an observation based on its type and title.",
      inputSchema: {
        type: "object",
        properties: {
          type:    { type: "string" },
          title:   { type: "string" },
          content: { type: "string" },
        },
        required: ["type", "title"],
      },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── mem_save ──────────────────────────────────────────────────────────────
    if (name === "mem_save") {
      const { title, content, type = "manual", topic_key, session_id, scope } = args as any;
      const pp = projectPath(args);

      const result = SaveMemoryUseCase.execute({
        title, content, type,
        topic_key, session_id, scope,
        project_path: pp,
      });

      if (!result.success) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      }

      const suggested = !topic_key
        ? `\nSuggested topic_key for future updates: \`${SuggestTopicKeyUseCase.execute(type, title, content)}\``
        : "";

      return {
        content: [{
          type: "text",
          text: `Memory saved: '${title}' (${type}) [id=${result.id}, action=${result.action}]${suggested}`,
        }],
      };
    }

    // ── mem_search ────────────────────────────────────────────────────────────
    if (name === "mem_search") {
      const { keyword, type, scope, limit } = args as any;
      const pp = projectPath(args);
      const results = SearchMemoriesUseCase.execute(keyword, pp, { type, scope, limit });

      if (!results.length) return { content: [{ type: "text", text: "No memories found." }] };

      const rows = results.map((r: any) =>
        `**[${r.id}] [${r.type}]** \`${r.topic_key || "—"}\` **${r.title}**\n${String(r.content).slice(0, 300)}\n_${r.created_at} | rev:${r.revision_count} dup:${r.duplicate_count}_`
      ).join("\n\n---\n\n");

      return { content: [{ type: "text", text: rows }] };
    }

    // ── mem_context ───────────────────────────────────────────────────────────
    if (name === "mem_context") {
      const { limit } = args as any;
      const pp = projectPath(args);
      const context = GetContextUseCase.execute(pp, limit);
      return { content: [{ type: "text", text: context }] };
    }

    // ── mem_delete ────────────────────────────────────────────────────────────
    if (name === "mem_delete") {
      const { id } = args as any;
      const pp = projectPath(args);
      const ok = DeleteMemoryUseCase.execute(Number(id), pp);
      return { content: [{ type: "text", text: ok ? `Memory #${id} deleted.` : `Memory #${id} not found.` }] };
    }

    // ── mem_finalize_session ──────────────────────────────────────────────────
    if (name === "mem_finalize_session") {
      const { topic_key, session_id, problem_statement, solution_summary, affected_files, key_learnings } = args as any;
      const pp = projectPath(args);

      const content = `## Goal\n${problem_statement}\n\n## Accomplished\n${solution_summary}\n\n## Relevant Files\n${affected_files}\n\n## Key Learnings\n${key_learnings}`;

      const result = SaveMemoryUseCase.execute({
        title: `Session: ${topic_key}`,
        content,
        type: "session_summary",
        topic_key,
        session_id,
        project_path: pp,
      });

      if (!result.success) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      }

      return { content: [{ type: "text", text: `Session finalized: ${topic_key} [id=${result.id}, action=${result.action}]` }] };
    }

    // ── mem_suggest_topic_key ─────────────────────────────────────────────────
    if (name === "mem_suggest_topic_key") {
      const { type, title, content } = args as any;
      const suggested = SuggestTopicKeyUseCase.execute(type, title, content);
      return { content: [{ type: "text", text: `Suggested topic_key: \`${suggested}\`` }] };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error: any) {
    console.error(`[drymem] error in ${name}: ${error.message}`);
    return { content: [{ type: "text", text: `Internal error: ${error.message}` }], isError: true };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[drymem] MCP server v2.0 running (project: ${currentProjectPath})`);
}

main().catch((error) => {
  console.error("Fatal error starting the server:", error);
  process.exit(1);
});
