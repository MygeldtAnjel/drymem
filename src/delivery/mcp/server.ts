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
