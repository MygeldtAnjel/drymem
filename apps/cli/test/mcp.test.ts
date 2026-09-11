/**
 * The MCP proxy.
 *
 * The lifecycle test exists because of a real bug: `connect()` resolves as soon
 * as the transport is wired up, so returning at that point let the CLI exit and
 * kill the server before it answered a single request. The tool list was fine;
 * nothing worked.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/mcp.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function rpc(id: number, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

/** Drive the built CLI's stdio MCP server and collect its replies. */
function talk(lines: string[], timeoutMs = 15000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI, "mcp"], {
      env: {
        ...process.env,
        // Unreachable on purpose: the protocol must work before any HTTP does.
        DRYMEM_SERVER_URL: "http://127.0.0.1:1",
        DRYMEM_TOKEN: "drymem_test-token-value-long-enough",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const messages: Record<string, unknown>[] = [];
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; got ${messages.length} message(s)`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        messages.push(JSON.parse(part) as Record<string, unknown>);
      }
      if (messages.length >= lines.filter((l) => l.includes('"id"')).length) {
        clearTimeout(timer);
        child.kill();
        resolve(messages);
      }
    });

    child.on("error", reject);
    for (const line of lines) child.stdin.write(line);
  });
}

describe("createServer", () => {
  it("builds without needing configuration", () => {
    // Config is read per call, so an unconfigured machine can still start the
    // server and report the problem as a tool result.
    expect(createServer()).toBeDefined();
  });
});

describe("stdio lifecycle", () => {
  it("stays alive to answer requests after connecting", async () => {
    const messages = await talk([
      rpc(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      rpc(2, "tools/list"),
    ]);

    const byId = new Map(messages.map((m) => [m.id, m]));
    expect(byId.get(1)).toBeDefined();
    expect(byId.get(2)).toBeDefined();
  });

  it("exposes exactly the five documented tools", async () => {
    const messages = await talk([
      rpc(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      rpc(2, "tools/list"),
    ]);

    const listed = messages.find((m) => m.id === 2) as
      | { result: { tools: Array<{ name: string }> } }
      | undefined;

    expect(listed?.result.tools.map((t) => t.name).sort()).toEqual([
      "mem_context",
      "mem_delete",
      "mem_finalize_session",
      "mem_search",
      "mem_update",
    ]);
  });

  it("reports an unreachable server as a tool result, not a protocol error", async () => {
    const messages = await talk([
      rpc(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      rpc(2, "tools/call", {
        name: "mem_search",
        arguments: { project_path: process.cwd(), query: "anything" },
      }),
    ]);

    const called = messages.find((m) => m.id === 2) as
      | { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: unknown }
      | undefined;

    expect(called?.error).toBeUndefined();
    expect(called?.result?.isError).toBe(true);
    expect(called?.result?.content[0]?.text).toContain("Cannot reach the drymem server");
  });
});
