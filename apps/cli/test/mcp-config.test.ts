/**
 * Registering the MCP server with each agent.
 *
 * Every one of these files belongs to the developer and usually has their own
 * servers in it. The tests that matter are the ones where something is already
 * there: a config that comes back without somebody's other MCP server is a bug
 * they will find in the middle of their work, not at install time.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { mcpEntry, registerMcp } from "../src/mcp-config.js";

let root: string;
let home: string;

const write = (path: string, body: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "drymem-root-"));
  home = mkdtempSync(join(tmpdir(), "drymem-home-"));
});

describe("Claude Code and Cursor", () => {
  it("writes the stdio entry where Cursor reads it", () => {
    const result = registerMcp("cursor", root, home);

    expect(result?.state).toBe("written");
    expect(result?.path).toBe(join(root, ".cursor", "mcp.json"));
    const config = JSON.parse(readFileSync(result!.path, "utf8"));
    expect(config.mcpServers.drymem).toEqual(mcpEntry());
  });

  it("keeps the servers that were already there", () => {
    const path = join(root, ".cursor", "mcp.json");
    write(path, JSON.stringify({ mcpServers: { linear: { command: "linear-mcp" } } }));

    registerMcp("cursor", root, home);

    const config = JSON.parse(readFileSync(path, "utf8"));
    expect(config.mcpServers.linear).toEqual({ command: "linear-mcp" });
    expect(config.mcpServers.drymem).toEqual(mcpEntry());
  });

  it("says so rather than rewriting when it is already correct", () => {
    registerMcp("cursor", root, home);
    expect(registerMcp("cursor", root, home)?.state).toBe("unchanged");
  });

  it("leaves a file it cannot parse exactly as it found it", () => {
    const path = join(root, ".cursor", "mcp.json");
    write(path, "{ this is not json");

    const result = registerMcp("cursor", root, home);

    expect(result?.state).toBe("skipped");
    expect(readFileSync(path, "utf8")).toBe("{ this is not json");
  });

  it("puts Claude Code's in the repository, and in the home file when global", () => {
    expect(registerMcp("claude-code", root, home)?.path).toBe(join(root, ".mcp.json"));
    expect(registerMcp("claude-code", root, home, true)?.path).toBe(join(home, ".claude.json"));
  });
});

describe("OpenCode", () => {
  it("uses its own shape: one command array, under `mcp`", () => {
    const result = registerMcp("opencode", root, home);

    expect(result?.path).toBe(join(root, "opencode.json"));
    const config = JSON.parse(readFileSync(result!.path, "utf8"));
    expect(config.mcp.drymem).toEqual({
      type: "local",
      command: ["npx", "--yes", "drymem", "mcp"],
      enabled: true,
    });
  });

  it("does not disturb the rest of somebody's opencode.json", () => {
    const path = join(root, "opencode.json");
    write(path, JSON.stringify({ theme: "tokyonight", mcp: { other: { type: "local" } } }));

    registerMcp("opencode", root, home);

    const config = JSON.parse(readFileSync(path, "utf8"));
    expect(config.theme).toBe("tokyonight");
    expect(config.mcp.other).toEqual({ type: "local" });
  });
});

describe("Codex", () => {
  it("appends a table instead of rewriting the file", () => {
    const path = join(root, ".codex", "config.toml");
    write(path, 'model = "gpt-5"\n\n# my own server\n[mcp_servers.context7]\ncommand = "npx"\n');

    registerMcp("codex", root, home);

    const body = readFileSync(path, "utf8");
    // Their comment and their server survive, ours is added at the end.
    expect(body).toContain("# my own server");
    expect(body).toContain("[mcp_servers.context7]");
    expect(body).toMatch(/\[mcp_servers\.drymem\]\ncommand = "npx"\nargs = \["--yes", "drymem", "mcp"\]\n$/);
  });

  it("does not add itself twice, which would make the file invalid TOML", () => {
    registerMcp("codex", root, home);
    const path = join(root, ".codex", "config.toml");
    const once = readFileSync(path, "utf8");

    expect(registerMcp("codex", root, home)?.state).toBe("unchanged");
    expect(readFileSync(path, "utf8")).toBe(once);
  });
});

describe("an agent we do not know", () => {
  it("is not written to at all", () => {
    expect(registerMcp("emacs", root, home)).toBe(null);
  });
});
