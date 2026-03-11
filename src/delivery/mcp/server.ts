import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Import use cases from core layer
import { SaveMemoryUseCase, SearchMemoriesUseCase, GetContextUseCase, DeleteMemoryUseCase } from "../../core/use-cases/memory-use-cases.js";
import { runMigrations } from "../../infrastructure/database/migrations.js";

// Redirect logs to avoid breaking the MCP protocol (Stdio)
console.log = console.error;
console.info = console.error;

// Run migrations automatically on startup
runMigrations();

// Initialize the MCP Server
const server = new Server(
  { name: "drymem-agent", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register tools for the LLM (Qwen 3.5)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mem_save",
        description: "Saves or updates an architectural decision or code. If the topic_key already exists, performs an upsert by incrementing the revision.",
        inputSchema: {
          type: "object",
          properties: {
            topic_key: { type: "string", description: "Unique identifier. Example: 'architecture/auth-model'" },
            project_path: { type: "string", description: "Current project path (or 'global' for generic)" },
            scope: { type: "string", enum: ["project", "personal"], description: "Scope of this memory" },
            query_input: { type: "string", description: "The initial question or problem posed by the user" },
            proposed_code: { type: "string", description: "The code proposed by the LLM" },
            content: { type: "string", description: "Summary of the final decision adopted or the final accepted code" },
            status: { type: "string", enum: ["ACCEPTED", "REJECTED", "DRAFT"], description: "Status of the proposal" }
          },
          required: ["topic_key", "project_path", "scope", "content"]
        }
      },
      {
        name: "mem_search",
        description: "Searches the developer memory by keywords. Ignores deleted memories.",
        inputSchema: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            project_path: { type: "string" }
          },
          required: ["keyword", "project_path"]
        }
      },
      {
        name: "mem_context",
        description: "Returns the recent timeline of memories for this project.",
        inputSchema: {
          type: "object",
          properties: { project_path: { type: "string" } },
          required: ["project_path"]
        }
      },
      {
        name: "mem_delete",
        description: "Applies a soft-delete to a specific memory.",
        inputSchema: {
          type: "object",
          properties: {
            topic_key: { type: "string" },
            project_path: { type: "string" }
          },
          required: ["topic_key", "project_path"]
        }
      },
      {
        name: "mem_finalize_session",
        description: "Creates a high-quality technical summary of an entire session. Use this when the user explicitly requests to save the interaction (e.g., 'save this interaction in drymem'). This tool formats the session into a structured Markdown summary and saves it as a memory.",
        inputSchema: {
          type: "object",
          properties: {
            topic_key: { type: "string", description: "Unique identifier for the session summary. Example: 'task/load-testing-setup' or 'rules/solid-principles'" },
            project_path: { type: "string", description: "Absolute path of the current workspace or monorepo sub-project. CRITICAL for isolation." },
            problem_statement: { type: "string", description: "The original problem or task that was addressed in this session" },
            solution_summary: { type: "string", description: "A concise summary of the solution that was implemented" },
            affected_files: { type: "string", description: "List of files that were modified or created during this session" },
            key_learnings: { type: "string", description: "Key technical insights, patterns, or lessons learned from this session" }
          },
          required: ["topic_key", "project_path", "problem_statement", "solution_summary", "affected_files", "key_learnings"]
        }
      }
    ]
  };
});

// Route tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    if (name === "mem_save") {
      const data = args as any;
      const result = SaveMemoryUseCase.execute({
        topic_key: data.topic_key,
        project_path: data.project_path,
        scope: data.scope,
        query_input: data.query_input || "",
        proposed_code: data.proposed_code || "",
        content: data.content,
        status: data.status || "ACCEPTED"
      });
      
      if (result.success) {
        return { content: [{ type: "text", text: `✅ Memory saved successfully: ${data.topic_key}` }] };
      } else {
        // If it fails, send the actual error to Qwen so it knows what to do
        return { content: [{ type: "text", text: `❌ SQLite database error: ${result.error}` }] };
      }
    }

    if (name === "mem_search") {
      const { keyword, project_path } = args as any;
      const results = SearchMemoriesUseCase.execute(keyword, project_path);
      return { content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : "No memories found." }] };
    }

    if (name === "mem_context") {
      const { project_path } = args as any;
      const results = GetContextUseCase.execute(project_path);
      return { content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : "No recent context." }] };
    }

    if (name === "mem_delete") {
      const { topic_key, project_path } = args as any;
      const success = DeleteMemoryUseCase.execute(topic_key, project_path);
      return { content: [{ type: "text", text: success ? `🗑️ Memory '${topic_key}' deleted (soft-delete).` : "Memory not found." }] };
    }

    if (name === "mem_finalize_session") {
      const sessionArgs = args as {
        topic_key: string;
        project_path: string;
        problem_statement: string;
        solution_summary: string;
        affected_files: string;
        key_learnings: string;
        scope?: string;
      };
      
      const { topic_key, project_path, problem_statement, solution_summary, affected_files, key_learnings } = sessionArgs;
      
      // Format the session summary as a clean Markdown string
      const markdownSummary = `
# Session Summary: ${topic_key}

## Problem Statement
${problem_statement}

## Solution Summary
${solution_summary}

## Affected Files
${affected_files}

## Key Learnings
${key_learnings}

---
*Generated by drymem MCP server - Engram-style session finalization*`;
      
      // Save the formatted summary using the existing save use case
      const result = SaveMemoryUseCase.execute({
        topic_key: topic_key,
        project_path: project_path,
        scope: sessionArgs.scope || "project",
        query_input: problem_statement,
        proposed_code: "",
        content: markdownSummary.trim(),
        status: "ACCEPTED"
      });
      
      if (result.success) {
        return { content: [{ type: "text", text: `✅ Session finalized and saved successfully: ${topic_key}` }] };
      } else {
        return { content: [{ type: "text", text: `❌ SQLite database error: ${result.error}` }] };
      }
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Internal error: ${error.message}` }], isError: true };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 Drymem MCP server running and listening to Qwen...");
}

main().catch((error) => {
  console.error("Fatal error starting the server:", error);
  process.exit(1);
});
