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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { DrymemClient, DrymemError } from "./client.js";
import { requireConfig } from "./config.js";
import { resolveProjectKey } from "./identity.js";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

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
      summary: z
        .string()
        .describe("Markdown body — include problem, solution, affected files, learnings."),
      topic_key: z
        .string()
        .optional()
        .describe("Optional stable key like 'auth/jwt-setup' for cross-session linking."),
    },
    async ({ project_path, summary, topic_key }) =>
      guard(async () => {
        const result = await client().save({
          project_key: resolveProjectKey(project_path),
          summary,
          topic_key: topic_key ?? "",
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
        const facts = await client().search(
          resolveProjectKey(project_path),
          query,
          num_results ?? 10,
        );
        if (facts.length === 0) return text("No memories found.");

        const lines = facts.map(
          (f) =>
            `- (${f.name}) ${f.fact}  (${formatDate(f.created_at)})` +
            (f.superseded ? " [superseded]" : ""),
        );
        return text(`Found ${facts.length} result(s):\n${lines.join("\n")}`);
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
          const who = e.author ? ` · ${e.author}` : "";
          return `### ${e.name} (${formatDate(e.created_at)}${who})\n${e.content.slice(0, 300)}\n`;
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
      update_summary: z.string().describe("What changed, bug found, fix applied."),
      replace: z.boolean().optional().describe("Delete old episode(s) first. Default false."),
    },
    async ({ project_path, topic_key, update_summary, replace }) =>
      guard(async () => {
        const result = await client().update(topic_key, {
          project_key: resolveProjectKey(project_path),
          update_summary,
          replace: replace ?? false,
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
