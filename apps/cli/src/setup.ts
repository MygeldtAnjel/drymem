/**
 * `npx drymem setup` — the whole install.
 *
 * Registers the MCP server and the session hooks in Claude Code's settings, and
 * stores the server URL and token. Everything it writes is merged into existing
 * files: a developer's settings.json is theirs, and clobbering their hooks to
 * install ours would be a good way to never be installed twice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { DrymemClient } from "./client.js";
import { DEFAULT_SERVER, loadConfig, saveConfig, type Config } from "./config.js";
import { runLogin } from "./login.js";

const HOOK_EVENTS = ["SessionStart", "Stop", "SubagentStop"] as const;

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}
type Settings = Record<string, unknown> & {
  hooks?: Record<string, HookGroup[]>;
  permissions?: { allow?: string[] };
  mcpServers?: Record<string, unknown>;
};

const TOOL_NAMES = [
  "mcp__drymem__mem_finalize_session",
  "mcp__drymem__mem_search",
  "mcp__drymem__mem_context",
  "mcp__drymem__mem_update",
  "mcp__drymem__mem_delete",
];

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** Ours are identified by command, so re-running replaces rather than duplicates. */
function isDrymemHook(entry: HookEntry): boolean {
  return entry.command.includes("drymem");
}

export function buildHooks(): Record<string, HookGroup[]> {
  const run = (event: string) => `npx --yes drymem hook ${event}`;
  return {
    SessionStart: [
      { matcher: "startup", hooks: [{ type: "command", command: run("session-start"), timeout: 10000 }] },
      { matcher: "compact", hooks: [{ type: "command", command: run("post-compaction"), timeout: 10000 }] },
    ],
    Stop: [{ hooks: [{ type: "command", command: run("session-stop"), timeout: 5000 }] }],
    SubagentStop: [{ hooks: [{ type: "command", command: run("subagent-stop"), timeout: 10000 }] }],
  };
}

/** Merge our hooks in, leaving anyone else's alone. */
export function mergeHooks(
  existing: Record<string, HookGroup[]> | undefined,
  ours: Record<string, HookGroup[]>,
): Record<string, HookGroup[]> {
  const merged: Record<string, HookGroup[]> = { ...(existing ?? {}) };

  for (const event of HOOK_EVENTS) {
    const theirs = (merged[event] ?? [])
      .map((group) => ({ ...group, hooks: group.hooks.filter((h) => !isDrymemHook(h)) }))
      .filter((group) => group.hooks.length > 0);
    merged[event] = [...theirs, ...(ours[event] ?? [])];
  }
  return merged;
}

export function mergePermissions(settings: Settings): Settings {
  const allow = new Set(settings.permissions?.allow ?? []);
  for (const name of TOOL_NAMES) allow.add(name);
  return {
    ...settings,
    permissions: { ...(settings.permissions ?? {}), allow: [...allow] },
  };
}

export function applySettings(settings: Settings): Settings {
  const withHooks: Settings = { ...settings, hooks: mergeHooks(settings.hooks, buildHooks()) };
  return mergePermissions(withHooks);
}

export function mcpEntry(): Record<string, unknown> {
  return { type: "stdio", command: "npx", args: ["--yes", "drymem", "mcp"], env: {} };
}

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function runSetup(
  options: { global?: boolean; serverUrl?: string } = {},
): Promise<number> {
  const current = loadConfig();
  const serverUrl =
    options.serverUrl ??
    (current?.serverUrl ?? (await ask("drymem server URL", DEFAULT_SERVER)));

  // Sign in through the browser unless this machine already has a token for
  // this server. Nobody types a token; `DRYMEM_TOKEN` in the environment still
  // works for CI, where there is no browser.
  let token = current?.serverUrl === serverUrl ? current.token : process.env.DRYMEM_TOKEN;
  if (!token) {
    const code = await runLogin({ serverUrl });
    if (code !== 0) return code;
    token = loadConfig()?.token;
  }
  if (!token) {
    console.error("Sign-in did not produce a token. Run `drymem login` and try again.");
    return 1;
  }

  const config: Config = { serverUrl, token };

  // Check before writing anything: a config that points nowhere is worse than
  // no config, because the failure shows up later inside an agent session.
  try {
    const health = await new DrymemClient(config).health();
    console.log(`Server: ${health.status} (postgres ${health.postgres}, neo4j ${health.neo4j})`);
    await new DrymemClient(config).projects();
  } catch (error) {
    console.error(`\nCould not use that server and token: ${error}`);
    console.error("Nothing was written. Check the URL and token, then try again.");
    return 1;
  }

  saveConfig(config);

  const root = options.global ? homedir() : process.cwd();
  const settingsPath = join(root, ".claude", "settings.json");
  writeJson(settingsPath, applySettings(readJson<Settings>(settingsPath, {})));

  const mcpPath = options.global
    ? join(homedir(), ".claude.json")
    : join(process.cwd(), ".mcp.json");
  const mcpConfig = readJson<{ mcpServers?: Record<string, unknown> }>(mcpPath, {});
  mcpConfig.mcpServers = { ...(mcpConfig.mcpServers ?? {}), drymem: mcpEntry() };
  writeJson(mcpPath, mcpConfig);

  console.log(`\nConfigured.`);
  console.log(`  signed in as this machine -> ${join(homedir(), ".drymem", "config.json")} (0600)`);
  console.log(`  hooks    -> ${settingsPath}`);
  console.log(`  mcp      -> ${mcpPath}`);
  console.log(`\nRestart Claude Code to pick this up.`);
  return 0;
}

export function setupPathsExist(): boolean {
  return existsSync(join(homedir(), ".drymem", "config.json"));
}
