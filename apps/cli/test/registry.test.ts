/**
 * Importing a public skill.
 *
 * Nothing here touches the network. The two things worth pinning down are the
 * reference someone types — people paste GitHub URLs, not `owner/repo` — and
 * what we read back off disk afterwards, because that is where an installer's
 * layout and ours have to meet.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { originOf, parseSpec, readSkillTree } from "../src/registry.js";

const SKILL = `---
name: retry-backoff
description: When retrying a payment call.
---

Cap the backoff at 30 seconds.
`;

let scratch: string | null = null;

function tree(layout: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), "drymem-registry-test-"));
  for (const [path, body] of Object.entries(layout)) {
    const full = join(scratch, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return scratch;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe("the reference someone types", () => {
  it("takes the plain form", () => {
    expect(parseSpec("anthropics/skills@pdf")).toEqual({
      owner: "anthropics",
      repo: "skills",
      skill: "pdf",
    });
  });

  it("takes a pasted URL, because that is what people have in the clipboard", () => {
    for (const raw of [
      "https://github.com/anthropics/skills",
      "github.com/anthropics/skills/",
      "www.github.com/anthropics/skills.git",
    ]) {
      expect(parseSpec(raw)).toEqual({ owner: "anthropics", repo: "skills" });
    }
  });

  it("refuses something that is not one", () => {
    expect(() => parseSpec("skills")).toThrow(/owner\/repo/);
    expect(() => parseSpec("a/b/c")).toThrow(/owner\/repo/);
  });

  it("keeps the origin readable, since it is stored and shown", () => {
    expect(originOf(parseSpec("anthropics/skills@pdf"))).toBe("github.com/anthropics/skills@pdf");
    expect(originOf(parseSpec("anthropics/skills"))).toBe("github.com/anthropics/skills");
  });
});

describe("reading it back off disk", () => {
  it("finds a SKILL.md sitting at the root", () => {
    const found = readSkillTree(tree({ "SKILL.md": SKILL }), "retry-backoff");
    expect(found?.content).toContain("30 seconds");
    expect(found?.name).toBe("retry-backoff");
  });

  it("takes the only skill in a repo without being told which", () => {
    const found = readSkillTree(tree({ "retry-backoff/SKILL.md": SKILL }));
    expect(found?.name).toBe("retry-backoff");
  });

  it("asks which one when there are several", () => {
    const root = tree({ "a/SKILL.md": SKILL, "b/SKILL.md": SKILL });
    expect(() => readSkillTree(root)).toThrow(/Pick one: a, b/);
  });

  it("says what is actually there when the name is wrong", () => {
    const root = tree({ "a/SKILL.md": SKILL, "b/SKILL.md": SKILL });
    expect(() => readSkillTree(root, "c")).toThrow(/Found: a, b/);
  });

  it("brings the reference files beside it", () => {
    const found = readSkillTree(
      tree({ "retry/SKILL.md": SKILL, "retry/TABLE.md": "| code | retry |" }),
      "retry",
    );
    expect(found?.files).toEqual({ "TABLE.md": "| code | retry |" });
  });

  it("leaves hidden files behind, so no marker travels with it", () => {
    const found = readSkillTree(
      tree({ "retry/SKILL.md": SKILL, "retry/.drymem-managed": "x", "retry/.git": "x" }),
      "retry",
    );
    expect(found?.files).toEqual({});
  });

  it("returns nothing rather than throwing when the directory is not there", () => {
    expect(readSkillTree(join(tmpdir(), "drymem-does-not-exist-9d1f"))).toBeNull();
  });
});
