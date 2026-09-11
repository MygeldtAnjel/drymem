/**
 * Settings merging.
 *
 * A developer's settings.json is theirs. If installing drymem wipes their own
 * hooks, or re-running setup stacks up duplicates, they uninstall it — so these
 * are the tests that decide whether the install is safe to run twice.
 */

import { describe, expect, it } from "vitest";

import { applySettings, buildHooks, mcpEntry, mergeHooks, mergePermissions } from "../src/setup.js";

const theirHook = { type: "command", command: "bash ./scripts/my-own-hook.sh" };

describe("mergeHooks", () => {
  it("installs our hooks into an empty settings file", () => {
    const merged = mergeHooks(undefined, buildHooks());

    expect(merged.SessionStart).toHaveLength(2);
    expect(merged.Stop?.[0]?.hooks[0]?.command).toContain("drymem hook session-stop");
  });

  it("keeps hooks that are not ours", () => {
    const merged = mergeHooks({ Stop: [{ hooks: [theirHook] }] }, buildHooks());

    const commands = merged.Stop?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    expect(commands).toContain("bash ./scripts/my-own-hook.sh");
    expect(commands.some((c) => c.includes("drymem"))).toBe(true);
  });

  it("is idempotent — running setup twice does not duplicate", () => {
    const once = mergeHooks(undefined, buildHooks());
    const twice = mergeHooks(once, buildHooks());

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("replaces an older drymem hook rather than stacking a second", () => {
    const old = { Stop: [{ hooks: [{ type: "command", command: "bash /old/path/drymem/stop.sh" }] }] };
    const merged = mergeHooks(old, buildHooks());

    const stop = merged.Stop?.flatMap((g) => g.hooks) ?? [];
    expect(stop).toHaveLength(1);
    expect(stop[0]?.command).toContain("npx --yes drymem");
  });

  it("leaves unrelated events untouched", () => {
    const merged = mergeHooks({ PreToolUse: [{ hooks: [theirHook] }] }, buildHooks());
    expect(merged.PreToolUse?.[0]?.hooks[0]?.command).toBe(theirHook.command);
  });
});

describe("mergePermissions", () => {
  it("adds all five tools", () => {
    const allow = mergePermissions({}).permissions?.allow ?? [];
    expect(allow).toHaveLength(5);
    expect(allow).toContain("mcp__drymem__mem_finalize_session");
  });

  it("keeps the user's existing permissions", () => {
    const allow = mergePermissions({ permissions: { allow: ["Bash(git *)"] } }).permissions?.allow ?? [];
    expect(allow).toContain("Bash(git *)");
  });

  it("does not duplicate on a second run", () => {
    const once = mergePermissions({});
    expect(mergePermissions(once).permissions?.allow).toHaveLength(5);
  });
});

describe("applySettings", () => {
  it("preserves unrelated keys", () => {
    const result = applySettings({ model: "opus", env: { FOO: "bar" } });

    expect(result.model).toBe("opus");
    expect(result.env).toEqual({ FOO: "bar" });
  });
});

describe("mcpEntry", () => {
  it("runs the published package, not a local path", () => {
    // A path would break the moment the repo moves — which is exactly how the
    // previous registration broke after the monorepo restructure.
    expect(mcpEntry()).toEqual({ type: "stdio", command: "npx", args: ["--yes", "drymem", "mcp"], env: {} });
  });
});
