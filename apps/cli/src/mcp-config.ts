/**
 * Registering drymem's MCP server with whichever agent is on this machine.
 *
 * Skills are platform-neutral files, so `platforms.ts` only has to know which
 * directory each agent reads. MCP configuration is not: every agent keeps its
 * servers in its own file, under its own key, and Codex keeps them in TOML.
 * That difference is all this file is.
 *
 * Two rules, both inherited from how we treat skill directories.
 *
 * **These files are the developer's, not ours.** Every write merges into what
 * is already there. A config with somebody's other MCP servers in it must come
 * back with those servers untouched.
 *
 * **Never guess at a file we cannot read.** A config we fail to parse is left
 * exactly as it is and reported, because a corrupted agent config is a worse
 * outcome than an unregistered memory server.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** How every agent is told to run us: stdio, over npx, no environment. */
export function mcpEntry(): Record<string, unknown> {
  return { type: "stdio", command: "npx", args: ["--yes", "drymem", "mcp"], env: {} };
}

export interface McpResult {
  platform: string;
  path: string;
  /** What happened: written, already correct, or left alone and why. */
  state: "written" | "unchanged" | "skipped";
  reason?: string;
}

type Merge = (existing: string | null) => { content: string | null; reason?: string };

const read = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, "utf8") : null;

const stringify = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function parse(existing: string | null): Record<string, unknown> | undefined {
  if (existing === null || existing.trim() === "") return {};
  try {
    const value = JSON.parse(existing);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Claude Code and Cursor share a shape: `mcpServers.drymem`. */
const mergeMcpServers: Merge = (existing) => {
  const config = parse(existing);
  if (!config) return { content: null, reason: "could not be parsed" };
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const next = { ...config, mcpServers: { ...servers, drymem: mcpEntry() } };
  const content = stringify(next);
  return { content: content === existing ? null : content };
};

/**
 * OpenCode: `mcp.drymem`, and its command is one array rather than a command
 * and its arguments.
 */
const mergeOpencode: Merge = (existing) => {
  const config = parse(existing);
  if (!config) return { content: null, reason: "could not be parsed" };
  const servers = (config.mcp ?? {}) as Record<string, unknown>;
  const next = {
    $schema: "https://opencode.ai/config.json",
    ...config,
    mcp: {
      ...servers,
      drymem: { type: "local", command: ["npx", "--yes", "drymem", "mcp"], enabled: true },
    },
  };
  const content = stringify(next);
  return { content: content === existing ? null : content };
};

/**
 * Codex: TOML, and appended rather than rewritten.
 *
 * Parsing and re-emitting somebody's TOML would lose their comments and their
 * ordering for the sake of one table we only ever add. Appending a new table at
 * the end is unambiguous — so the only case to detect is that ours is already
 * there, which would make the file invalid if written twice.
 */
const mergeCodexToml: Merge = (existing) => {
  const body = existing ?? "";
  if (/^\s*\[mcp_servers\.drymem\]/m.test(body)) return { content: null };
  const table = '[mcp_servers.drymem]\ncommand = "npx"\nargs = ["--yes", "drymem", "mcp"]\n';
  const separator = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return { content: `${body}${separator}${table}` };
};

interface Target {
  /** Where this agent keeps its MCP servers, for a repository and for a machine. */
  path: (root: string, home: string, global: boolean) => string;
  merge: Merge;
}

export const MCP_TARGETS: Record<string, Target> = {
  "claude-code": {
    path: (root, home, global) => (global ? join(home, ".claude.json") : join(root, ".mcp.json")),
    merge: mergeMcpServers,
  },
  cursor: {
    path: (root, home, global) =>
      global ? join(home, ".cursor", "mcp.json") : join(root, ".cursor", "mcp.json"),
    merge: mergeMcpServers,
  },
  opencode: {
    path: (root, home, global) =>
      global
        ? join(home, ".config", "opencode", "opencode.json")
        : join(root, "opencode.json"),
    merge: mergeOpencode,
  },
  codex: {
    path: (root, home, global) =>
      global ? join(home, ".codex", "config.toml") : join(root, ".codex", "config.toml"),
    merge: mergeCodexToml,
  },
};

/** Register drymem with one agent. */
export function registerMcp(
  platform: string,
  root: string,
  home: string,
  global = false,
): McpResult | null {
  const target = MCP_TARGETS[platform];
  if (!target) return null;

  const path = target.path(root, home, global);
  const { content, reason } = target.merge(read(path));
  if (content === null) {
    return { platform, path, state: reason ? "skipped" : "unchanged", reason };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { platform, path, state: "written" };
}
