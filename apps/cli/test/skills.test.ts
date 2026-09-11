/**
 * Skill sync.
 *
 * `.claude/skills/` belongs to the team; drymem is a guest in it. The test that
 * matters most is that a skill someone edited survives a sync — everything else
 * here is recoverable, and overwriting someone's work is not.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  LOCK_PATH,
  SKILLS_DIR,
  availableSkills,
  hashSkill,
  readLock,
  gaps,
  statusOf,
  sync,
  writeDraft,
} from "../src/skills.js";

const VERSION = "2.1.0";
let bundled: string;
let project: string;

function makeSkill(root: string, name: string, body = "---\nname: x\n---\n\nDo the thing.") {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
  return dir;
}

beforeEach(() => {
  bundled = mkdtempSync(join(tmpdir(), "drymem-bundle-"));
  project = mkdtempSync(join(tmpdir(), "drymem-proj-"));
  makeSkill(bundled, "tdd");
  makeSkill(bundled, "code-review");
});

const installed = (name: string) => join(project, SKILLS_DIR, name, "SKILL.md");

describe("hashing", () => {
  it("is stable for identical content", () => {
    const a = makeSkill(mkdtempSync(join(tmpdir(), "a-")), "s");
    const b = makeSkill(mkdtempSync(join(tmpdir(), "b-")), "s");
    expect(hashSkill(a)).toBe(hashSkill(b));
  });

  it("changes when content changes", () => {
    const dir = makeSkill(mkdtempSync(join(tmpdir(), "c-")), "s");
    const before = hashSkill(dir);
    writeFileSync(join(dir, "SKILL.md"), "different");
    expect(hashSkill(dir)).not.toBe(before);
  });

  it("changes when a file is added", () => {
    const dir = makeSkill(mkdtempSync(join(tmpdir(), "d-")), "s");
    const before = hashSkill(dir);
    writeFileSync(join(dir, "reference.md"), "more");
    expect(hashSkill(dir)).not.toBe(before);
  });

  it("notices a rename, not just content", () => {
    const dir = makeSkill(mkdtempSync(join(tmpdir(), "e-")), "s");
    writeFileSync(join(dir, "a.md"), "same bytes");
    const before = hashSkill(dir);
    rmSync(join(dir, "a.md"));
    writeFileSync(join(dir, "b.md"), "same bytes");
    expect(hashSkill(dir)).not.toBe(before);
  });
});

describe("sync", () => {
  it("installs everything on a fresh project", () => {
    const result = sync(project, VERSION, { bundled });

    expect(result.installed.sort()).toEqual(["code-review", "tdd"]);
    expect(existsSync(installed("tdd"))).toBe(true);
    expect(Object.keys(readLock(project).skills).sort()).toEqual(["code-review", "tdd"]);
  });

  it("is a no-op on a second run", () => {
    sync(project, VERSION, { bundled });
    const again = sync(project, VERSION, { bundled });

    expect(again.installed).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.untouched.sort()).toEqual(["code-review", "tdd"]);
  });

  it("NEVER overwrites a skill someone edited", () => {
    sync(project, VERSION, { bundled });
    writeFileSync(installed("tdd"), "My own version, hard-won.");

    const result = sync(project, VERSION, { bundled });

    expect(result.skipped).toEqual(["tdd"]);
    expect(readFileSync(installed("tdd"), "utf8")).toBe("My own version, hard-won.");
  });

  it("replaces an edited skill only when forced", () => {
    sync(project, VERSION, { bundled });
    writeFileSync(installed("tdd"), "mine");

    sync(project, VERSION, { bundled, force: true });

    expect(readFileSync(installed("tdd"), "utf8")).toContain("Do the thing.");
  });

  it("never touches a skill the team wrote themselves", () => {
    makeSkill(join(project, SKILLS_DIR), "our-deploy-checklist", "ours");

    const result = sync(project, VERSION, { bundled });

    expect(result.untouched).toContain("our-deploy-checklist");
    expect(readFileSync(installed("our-deploy-checklist"), "utf8")).toBe("ours");
  });

  it("does not touch a team skill even with --force", () => {
    // force means "give me your version of *our* skill back", never "discard mine".
    makeSkill(join(project, SKILLS_DIR), "our-deploy-checklist", "ours");

    sync(project, VERSION, { bundled, force: true });

    expect(readFileSync(installed("our-deploy-checklist"), "utf8")).toBe("ours");
  });

  it("reinstalls a skill that was deleted", () => {
    sync(project, VERSION, { bundled });
    rmSync(join(project, SKILLS_DIR, "tdd"), { recursive: true });

    expect(sync(project, VERSION, { bundled }).installed).toEqual(["tdd"]);
  });

  it("updates when the bundled skill changes", () => {
    sync(project, VERSION, { bundled });
    writeFileSync(join(bundled, "tdd", "SKILL.md"), "---\nname: tdd\n---\n\nNew guidance.");

    const result = sync(project, VERSION, { bundled });

    expect(result.updated).toEqual(["tdd"]);
    expect(readFileSync(installed("tdd"), "utf8")).toContain("New guidance.");
  });

  it("writes nothing on a dry run", () => {
    const result = sync(project, VERSION, { bundled, dryRun: true });

    expect(result.installed.sort()).toEqual(["code-review", "tdd"]);
    expect(existsSync(installed("tdd"))).toBe(false);
    expect(existsSync(join(project, LOCK_PATH))).toBe(false);
  });

  it("copies every file in a skill, not just SKILL.md", () => {
    writeFileSync(join(bundled, "tdd", "mocking.md"), "how to mock");
    sync(project, VERSION, { bundled });

    expect(existsSync(join(project, SKILLS_DIR, "tdd", "mocking.md"))).toBe(true);
  });

  it("does nothing when there is no bundle", () => {
    expect(sync(project, VERSION, { bundled: null }).installed).toEqual([]);
  });
});

describe("status", () => {
  it("reports the four states", () => {
    makeSkill(join(project, SKILLS_DIR), "ours", "theirs");
    sync(project, VERSION, { bundled });
    writeFileSync(installed("tdd"), "edited");
    rmSync(join(project, SKILLS_DIR, "code-review"), { recursive: true });

    const byName = new Map(statusOf(project, VERSION, bundled).map((s) => [s.name, s.state]));

    expect(byName.get("tdd")).toBe("modified");
    expect(byName.get("code-review")).toBe("missing");
    expect(byName.get("ours")).toBe("unknown");
  });

  it("reports installed after a clean sync", () => {
    sync(project, VERSION, { bundled });
    const byName = new Map(statusOf(project, VERSION, bundled).map((s) => [s.name, s.state]));

    expect(byName.get("tdd")).toBe("installed");
  });

  it("reports outdated when the bundle has moved on", () => {
    sync(project, VERSION, { bundled });
    writeFileSync(join(bundled, "tdd", "SKILL.md"), "newer");

    const byName = new Map(statusOf(project, VERSION, bundled).map((s) => [s.name, s.state]));
    expect(byName.get("tdd")).toBe("outdated");
  });
});

describe("the lock file", () => {
  it("survives being absent", () => {
    expect(readLock(project)).toEqual({ version: 1, skills: {} });
  });

  it("survives being corrupt", () => {
    mkdirSync(join(project, ".drymem"), { recursive: true });
    writeFileSync(join(project, LOCK_PATH), "{not json");

    expect(readLock(project).skills).toEqual({});
  });

  it("records a hash that matches what landed", () => {
    sync(project, VERSION, { bundled });
    const entry = readLock(project).skills["tdd"];

    expect(entry?.hash).toBe(hashSkill(join(project, SKILLS_DIR, "tdd")));
    expect(entry?.version).toBe(VERSION);
  });
});

describe("the real bundled set", () => {
  it("finds the 18 skills we ship", () => {
    const names = availableSkills();
    expect(names).toContain("tdd");
    expect(names).toContain("grilling");
    expect(names.length).toBeGreaterThanOrEqual(18);
  });
});

describe("gaps", () => {
  it("hides a subject an installed skill already covers", () => {
    sync(project, VERSION, { bundled });
    const found = gaps([{ topic: "tdd", memory_count: 5 }], project, bundled);

    expect(found).toEqual([]);
  });

  it("surfaces a subject nothing covers", () => {
    sync(project, VERSION, { bundled });
    const found = gaps([{ topic: "Adyen", memory_count: 5 }], project, bundled);

    expect(found.map((g) => g.topic)).toEqual(["Adyen"]);
  });

  it("matches a skill's description, not just its name", () => {
    // `code-review` is named for the activity; a memory cluster about "review"
    // should not be reported as uncovered.
    writeFileSync(
      join(bundled, "code-review", "SKILL.md"),
      "---\nname: code-review\ndescription: Review a branch against the spec.\n---\n\nDo it.",
    );
    sync(project, VERSION, { bundled });

    expect(gaps([{ topic: "spec", memory_count: 3 }], project, bundled)).toEqual([]);
  });

  it("counts a skill the team wrote themselves as coverage", () => {
    makeSkill(
      join(project, SKILLS_DIR),
      "adyen-quirks",
      "---\nname: adyen-quirks\ndescription: Adyen's authorisation rules.\n---\n\nours",
    );

    expect(gaps([{ topic: "adyen", memory_count: 9 }], project, bundled)).toEqual([]);
  });

  it("ignores an empty topic", () => {
    expect(gaps([{ topic: "  ", memory_count: 3 }], project, bundled)).toEqual([]);
  });

  it("is case insensitive", () => {
    sync(project, VERSION, { bundled });
    expect(gaps([{ topic: "TDD", memory_count: 4 }], project, bundled)).toEqual([]);
  });
});

describe("writeDraft", () => {
  it("writes where a person will find it, and does not install it", () => {
    const path = writeDraft(project, "adyen", "---\nname: adyen\n---\n\nbody");

    expect(path).toContain(join(".drymem", "drafts"));
    expect(readFileSync(path, "utf8")).toContain("name: adyen");
    // The critical part: a draft must not become an active skill by itself.
    expect(existsSync(join(project, SKILLS_DIR, "adyen"))).toBe(false);
  });

  it("ends the file with a newline", () => {
    const path = writeDraft(project, "x", "no trailing newline");
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });
});
