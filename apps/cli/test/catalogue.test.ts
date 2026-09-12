/**
 * Installing skills on a machine.
 *
 * The guarantee under test is the one a team actually feels: drymem is a guest
 * in `.claude/skills` and its siblings. A skill somebody wrote by hand, sitting
 * right next to ours, must survive every pull and every removal — with or
 * without a flag, forever.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyToDisk, chosenPlatforms } from "../src/catalogue.js";
import { MARKER, PLATFORMS, managed, platformById, uninstall } from "../src/platforms.js";
import { readLockfile, writeLockfile } from "../src/lockfile.js";

let root: string;
const claude = platformById("claude-code")!;
const cursor = platformById("cursor")!;

const SKILL = "---\nname: retry\ndescription: When retrying.\n---\n\nCap at 30s.\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "drymem-skills-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("installing", () => {
  it("writes the skill and a marker saying it is ours", () => {
    applyToDisk(root, [claude], [{ name: "retry", content: SKILL }]);
    expect(readFileSync(join(root, ".claude/skills/retry/SKILL.md"), "utf8")).toBe(SKILL);
    expect(existsSync(join(root, ".claude/skills/retry", MARKER))).toBe(true);
  });

  it("writes extra files inside the skill's own folder", () => {
    applyToDisk(root, [claude], [
      { name: "retry", content: SKILL, files: { "table.md": "a|b\n" } },
    ]);
    expect(readFileSync(join(root, ".claude/skills/retry/table.md"), "utf8")).toBe("a|b\n");
  });

  it("refuses to let a file escape the skill's folder", () => {
    applyToDisk(root, [claude], [
      { name: "retry", content: SKILL, files: { "../../escaped.md": "no" } },
    ]);
    expect(existsSync(join(root, "escaped.md"))).toBe(false);
  });

  it("does nothing the second time", () => {
    applyToDisk(root, [claude], [{ name: "retry", content: SKILL }]);
    const again = applyToDisk(root, [claude], [{ name: "retry", content: SKILL }]);
    expect(again[0]!.unchanged).toEqual(["retry"]);
    expect(again[0]!.installed).toEqual([]);
  });

  it("rewrites when the content changes", () => {
    applyToDisk(root, [claude], [{ name: "retry", content: SKILL }]);
    const next = SKILL.replace("30s", "60s");
    const result = applyToDisk(root, [claude], [{ name: "retry", content: next }]);
    expect(result[0]!.installed).toEqual(["retry"]);
    expect(readFileSync(join(root, ".claude/skills/retry/SKILL.md"), "utf8")).toContain("60s");
  });

  it("writes Cursor's as a rule file, not a folder", () => {
    applyToDisk(root, [cursor], [{ name: "retry", content: SKILL }]);
    expect(readFileSync(join(root, ".cursor/rules/retry.drymem.mdc"), "utf8")).toBe(SKILL);
  });
});

describe("being a guest", () => {
  function handWritten() {
    const dir = join(root, ".claude/skills/theirs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "Somebody wrote this by hand.\n");
  }

  it("never lists a skill it did not write", () => {
    handWritten();
    applyToDisk(root, [claude], [{ name: "retry", content: SKILL }]);
    expect(managed(root, claude).sort()).toEqual(["retry"]);
  });

  it("never removes one either", () => {
    handWritten();
    applyToDisk(root, [claude], [{ name: "retry", content: SKILL }]);
    // The enabled set shrinks to nothing; ours goes, theirs stays.
    const result = applyToDisk(root, [claude], []);
    expect(result[0]!.removed).toEqual(["retry"]);
    expect(existsSync(join(root, ".claude/skills/retry"))).toBe(false);
    expect(existsSync(join(root, ".claude/skills/theirs/SKILL.md"))).toBe(true);
  });

  it("refuses an explicit uninstall of somebody else's", () => {
    handWritten();
    expect(uninstall(root, claude, "theirs")).toBe(false);
    expect(existsSync(join(root, ".claude/skills/theirs/SKILL.md"))).toBe(true);
  });

  it("leaves a Cursor rule that is not ours alone", () => {
    const dir = join(root, ".cursor/rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "house-style.mdc"), "theirs");
    applyToDisk(root, [cursor], [{ name: "retry", content: SKILL }]);
    applyToDisk(root, [cursor], []);
    expect(existsSync(join(dir, "house-style.mdc"))).toBe(true);
    expect(existsSync(join(dir, "retry.drymem.mdc"))).toBe(false);
  });
});

describe("choosing agents", () => {
  it("installs for the ones named", () => {
    const chosen = chosenPlatforms(["--cursor", "--codex"], root);
    expect(chosen.map((p) => p.id).sort()).toEqual(["codex", "cursor"]);
  });

  it("--all means all of them", () => {
    expect(chosenPlatforms(["--all"], root)).toHaveLength(PLATFORMS.length);
  });

  it("detects the ones configured in the repo when nothing is named", () => {
    mkdirSync(join(root, ".opencode"), { recursive: true });
    const chosen = chosenPlatforms([], root);
    expect(chosen.map((p) => p.id)).toContain("opencode");
  });
});

describe("the lockfile", () => {
  it("round-trips, sorted, with a trailing newline", () => {
    writeLockfile(root, {
      lockfileVersion: 1,
      project: "github.com/acme/pay",
      generatedAt: "2026-09-12T00:00:00.000Z",
      skills: [
        { name: "zeta", version: 2, sha256: "b".repeat(64), source: "authored" },
        { name: "alpha", version: 1, sha256: "a".repeat(64), source: "distilled" },
      ],
    });
    const raw = readFileSync(join(root, ".drymem/skills.lock"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    // Sorted, so the file does not churn in a diff on every write.
    expect(readLockfile(root)!.skills.map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });

  it("treats a corrupt lockfile as no lockfile", () => {
    mkdirSync(join(root, ".drymem"), { recursive: true });
    writeFileSync(join(root, ".drymem/skills.lock"), "{ not json");
    expect(readLockfile(root)).toBeNull();
  });
});
