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

import { readPayload, sessionStart, sessionStop, subagentStop } from "../src/hooks.js";

/**
 * The project's capture mode, which the hooks ask the server for.
 *
 * Mocked rather than reached: these tests are about whether the answer is
 * *obeyed*, and a test that needs a server to prove it would not have caught
 * the bug it exists for — nothing called this method at all.
 */
const captureMode = vi.fn(async () => "automatic");
// `save` refuses, because every test here points at a server on port 1. The
// suite's oldest rule is that a hook survives an unreachable server, and a
// mock that always succeeds would quietly retire the test that proves it.
const save = vi.fn(async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:1");
});
vi.mock("../src/client.js", async (real) => ({
  ...(await real<typeof import("../src/client.js")>()),
  DrymemClient: class {
    captureMode = captureMode;
    save = save;
  },
}));

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


describe("what a project's capture mode actually does", () => {
  it("does not autosave when the project saves manually", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    captureMode.mockResolvedValueOnce("manual");

    await sessionStop({
      cwd: process.cwd(),
      session_id: "deadbeef",
      // Long enough, and the agent never saved: under `automatic` this is
      // exactly the case that autosaves.
      last_assistant_message: "x".repeat(400),
    });

    expect(errors).toHaveBeenCalledWith(
      "drymem: capture is manual on this project, not autosaving",
    );
    errors.mockRestore();
  });

  it("does not autosave when the project asks first", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    captureMode.mockResolvedValueOnce("ask");

    await sessionStop({ cwd: process.cwd(), last_assistant_message: "x".repeat(400) });

    expect(errors).toHaveBeenCalledWith("drymem: capture is ask on this project, not autosaving");
    errors.mockRestore();
  });

  it("still autosaves when the project is automatic", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    captureMode.mockResolvedValueOnce("automatic");

    await sessionStop({ cwd: process.cwd(), last_assistant_message: "x".repeat(400) });

    expect(errors).not.toHaveBeenCalledWith(
      expect.stringContaining("not autosaving"),
    );
    errors.mockRestore();
  });

  it("falls back to automatic when the server cannot be asked", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    captureMode.mockRejectedValueOnce(new Error("no route to host"));

    await sessionStop({ cwd: process.cwd(), last_assistant_message: "x".repeat(400) });

    // Being unable to ask is not a reason to change behaviour silently.
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining("not autosaving"));
    errors.mockRestore();
  });

  it("tells the agent not to save, on a manual project", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureMode.mockResolvedValue("manual");

    await sessionStart({ cwd: process.cwd() });

    const injected = out.mock.calls.flat().join("\n");
    expect(injected).toContain("RULE 3 — DO NOT SAVE");
    expect(injected).not.toContain("RULE 3 — PROACTIVE SAVING");
    // Reading memory is unaffected by how a project saves.
    expect(injected).toContain("RULE 2 — PROACTIVE RETRIEVAL");
    vi.restoreAllMocks();
    captureMode.mockResolvedValue("automatic");
  });

  it("asks first, on a project set to ask", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureMode.mockResolvedValue("ask");

    await sessionStart({ cwd: process.cwd() });

    expect(out.mock.calls.flat().join("\n")).toContain("RULE 3 — SAVING, ON CONFIRMATION");
    vi.restoreAllMocks();
    captureMode.mockResolvedValue("automatic");
  });
});
