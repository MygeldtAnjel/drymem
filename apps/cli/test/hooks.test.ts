/**
 * Hook behaviour.
 *
 * The rule that matters most: a hook never breaks the session it runs in, so
 * every failure path still resolves.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { readPayload, sessionStop, subagentStop } from "../src/hooks.js";

function transcript(lines: string[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "drymem-t-")), "session.jsonl");
  writeFileSync(path, lines.join("\n"));
  return path;
}

const assistantWith = (name: string) =>
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name }] },
  });

describe("readPayload", () => {
  it("parses the hook JSON from stdin", async () => {
    const payload = await readPayload(Readable.from([JSON.stringify({ cwd: "/tmp", session_id: "abc" })]));
    expect(payload.cwd).toBe("/tmp");
  });

  it("returns an empty payload for malformed input rather than throwing", async () => {
    expect(await readPayload(Readable.from(["not json at all"]))).toEqual({});
  });
});

describe("sessionStop", () => {
  it("skips when the agent already saved", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DRYMEM_SERVER_URL = "http://127.0.0.1:1";
    process.env.DRYMEM_TOKEN = "drymem_test-token-value-long-enough";

    await sessionStop({
      cwd: process.cwd(),
      transcript_path: transcript([assistantWith("mcp__drymem__mem_finalize_session")]),
      last_assistant_message: "x".repeat(200),
    });

    expect(errors).toHaveBeenCalledWith("drymem: agent already saved");
    errors.mockRestore();
  });

  it("does not mistake another drymem tool for a save", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await sessionStop({
      cwd: process.cwd(),
      transcript_path: transcript([assistantWith("mcp__drymem__mem_search")]),
      last_assistant_message: "short",
    });

    expect(errors).toHaveBeenCalledWith("drymem: nothing substantial to save");
    errors.mockRestore();
  });

  it("skips a trivial last message", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await sessionStop({ cwd: process.cwd(), last_assistant_message: "ok" });

    expect(errors).toHaveBeenCalledWith("drymem: nothing substantial to save");
    errors.mockRestore();
  });

  it("survives an unreachable server", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sessionStop({ cwd: process.cwd(), session_id: "deadbeef", last_assistant_message: "y".repeat(200) }),
    ).resolves.toBeUndefined();

    expect(errors.mock.calls.flat().join(" ")).toContain("autosave failed");
    errors.mockRestore();
  });

  it("survives a missing transcript file", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sessionStop({ cwd: process.cwd(), transcript_path: "/no/such/file.jsonl", last_assistant_message: "ok" }),
    ).resolves.toBeUndefined();
    errors.mockRestore();
  });

  it("ignores a half-written final line", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await sessionStop({
      cwd: process.cwd(),
      transcript_path: transcript([assistantWith("mcp__drymem__mem_finalize_session"), '{"type":"assist']),
      last_assistant_message: "x".repeat(200),
    });

    expect(errors).toHaveBeenCalledWith("drymem: agent already saved");
    errors.mockRestore();
  });
});

describe("subagentStop", () => {
  it("surfaces reported findings", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await subagentStop({ last_assistant_message: "## Key Learnings\nThe retry loop was unbounded." });

    expect(errors.mock.calls.flat().join(" ")).toContain("Persist them");
    errors.mockRestore();
  });

  it("stays quiet otherwise", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await subagentStop({ last_assistant_message: "Done, all tests pass." });

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
