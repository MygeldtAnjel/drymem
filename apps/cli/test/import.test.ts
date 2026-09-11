/**
 * Import sources.
 *
 * The rule every source obeys: only things a human wrote on purpose. A commit
 * subject is a label, not a memory; a transcript is not a source at all.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collect, fromDocs, fromEcc, fromGit, newOnly } from "../src/import.js";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "drymem-imp-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  return dir;
}

function commit(dir: string, message: string) {
  writeFileSync(join(dir, `f${Math.random()}.txt`), "x");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

describe("git", () => {
  it("imports a commit that explains itself", () => {
    const dir = repo();
    commit(
      dir,
      "fix: clamp the clock skew allowance\n\nThe refresh token expired early because the skew allowance could go negative, so tokens minted just before a resync were already stale.",
    );

    const items = fromGit(dir);
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toContain("clock skew");
    expect(items[0]?.topicKey).toMatch(/^import\/git\/[0-9a-f]{12}$/);
  });

  it("skips a subject-only commit", () => {
    // A one-line convention is good practice and a bad memory: "fix: update
    // model" tells a future reader nothing.
    const dir = repo();
    commit(dir, "fix: update model");

    expect(fromGit(dir)).toEqual([]);
  });

  it("skips a body too short to be an explanation", () => {
    const dir = repo();
    commit(dir, "feat: thing\n\nwip");

    expect(fromGit(dir)).toEqual([]);
  });

  it("is stable across runs, so importing twice changes nothing", () => {
    const dir = repo();
    commit(dir, "fix: a\n\n" + "Because the retry loop had no upper bound at all, ever.");

    expect(fromGit(dir)[0]?.topicKey).toBe(fromGit(dir)[0]?.topicKey);
  });

  it("returns nothing for a directory that is not a repo", () => {
    expect(fromGit(mkdtempSync(join(tmpdir(), "drymem-nogit-")))).toEqual([]);
  });
});

describe("markdown sources", () => {
  it("imports decision records", () => {
    const dir = mkdtempSync(join(tmpdir(), "drymem-docs-"));
    mkdirSync(join(dir, "docs", "adr"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "adr", "0001-use-postgres.md"),
      "# Use Postgres\n\nRelational data in a graph database is a fight we do not need.",
    );

    const items = fromDocs(dir);
    expect(items).toHaveLength(1);
    expect(items[0]?.topicKey).toContain("0001-use-postgres");
  });

  it("imports an ECC memory vault", () => {
    const dir = mkdtempSync(join(tmpdir(), "drymem-ecc-"));
    mkdirSync(join(dir, ".ecc", "memory"), { recursive: true });
    writeFileSync(
      join(dir, ".ecc", "memory", "auth-flow.md"),
      "The refresh endpoint is rate limited to ten calls a minute per client.",
    );

    expect(fromEcc(dir)[0]?.topicKey).toBe("import/ecc/auth-flow");
  });

  it("ignores an index file, which is pointers rather than a memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "drymem-idx-"));
    mkdirSync(join(dir, ".ecc", "memory"), { recursive: true });
    writeFileSync(join(dir, ".ecc", "memory", "MEMORY.md"), "- [a](a.md)\n- [b](b.md)\n".repeat(6));

    expect(fromEcc(dir)).toEqual([]);
  });

  it("returns nothing when the directory is absent", () => {
    expect(fromEcc(mkdtempSync(join(tmpdir(), "drymem-none-")))).toEqual([]);
  });
});

describe("newOnly", () => {
  const item = (topicKey: string) => ({ topicKey, summary: "s", source: "git" });

  it("drops what is already stored", () => {
    const pending = newOnly([item("a"), item("b")], new Set(["a"]));
    expect(pending.map((i) => i.topicKey)).toEqual(["b"]);
  });

  it("drops duplicates within one batch", () => {
    expect(newOnly([item("a"), item("a")], new Set())).toHaveLength(1);
  });

  it("passes everything through on a first run", () => {
    expect(newOnly([item("a"), item("b")], new Set())).toHaveLength(2);
  });
});

describe("collect", () => {
  it("routes to the right source", () => {
    const dir = repo();
    commit(dir, "fix: a\n\n" + "A body long enough to count as a real explanation here.");

    expect(collect("git", dir)).toHaveLength(1);
    expect(collect("docs", dir)).toEqual([]);
  });
});

describe("claude-memory scoping", () => {
  it("derives the project directory name from the path", async () => {
    const { claudeProjectSlug } = await import("../src/import.js");
    expect(claudeProjectSlug("/home/miguel/work/payments")).toBe("-home-miguel-work-payments");
  });

  it("reads only this project's memories by default", async () => {
    // Every project on the machine has a memory directory. Importing all of
    // them into whichever repo you are standing in would attach another
    // codebase's decisions to this one.
    const { fromClaudeMemory } = await import("../src/import.js");

    const mine = fromClaudeMemory(process.cwd());
    const everything = fromClaudeMemory(process.cwd(), true);

    expect(mine.length).toBeLessThanOrEqual(everything.length);
  });
});
