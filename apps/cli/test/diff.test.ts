/**
 * Comparing two versions of a skill.
 *
 * The reason this is worth testing rather than eyeballing: a skill is mostly
 * prose that did not change, so the interesting behaviour is what gets left
 * out, not what gets printed.
 */

import { describe, expect, it } from "vitest";

import { changed, lineDiff, unified } from "../src/diff.js";

describe("the line diff", () => {
  it("says nothing changed when nothing did", () => {
    const hunks = lineDiff("a\nb\nc", "a\nb\nc");
    expect(changed(hunks)).toEqual({ added: 0, removed: 0 });
    expect(hunks.every((h) => h.kind === "same")).toBe(true);
  });

  it("counts a replaced line as one of each", () => {
    const hunks = lineDiff("cap at 30 seconds", "cap at 60 seconds");
    expect(changed(hunks)).toEqual({ added: 1, removed: 1 });
  });

  it("keeps the surrounding lines in order", () => {
    const hunks = lineDiff("a\nb\nc", "a\nB\nc");
    expect(hunks.map((h) => `${h.kind}:${h.line}`)).toEqual([
      "same:a",
      "remove:b",
      "add:B",
      "same:c",
    ]);
  });

  it("handles one side being empty", () => {
    expect(changed(lineDiff("", "a\nb"))).toEqual({ added: 2, removed: 1 });
    expect(changed(lineDiff("a\nb", ""))).toEqual({ added: 1, removed: 2 });
  });

  it("finds the smallest edit rather than replacing everything", () => {
    // A naive walk would call this four changes instead of one insertion.
    const hunks = lineDiff("a\nb\nc\nd", "a\nb\nX\nc\nd");
    expect(changed(hunks)).toEqual({ added: 1, removed: 0 });
  });
});

describe("what gets printed", () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");

  it("collapses the prose that did not move", () => {
    const after = long.replace("line 20", "line twenty");
    const out = unified(lineDiff(long, after));
    expect(out.filter((l) => l === "  …").length).toBeGreaterThan(0);
    // Two lines of context either side of the one change, plus the markers.
    expect(out.length).toBeLessThan(12);
    expect(out).toContain("- line 20");
    expect(out).toContain("+ line twenty");
  });

  it("never prints two elision markers in a row", () => {
    const out = unified(lineDiff(long, long.replace("line 1\n", "")));
    for (let i = 1; i < out.length; i++) {
      expect(out[i] === "  …" && out[i - 1] === "  …").toBe(false);
    }
  });

  it("prints nothing but markers when there is no change", () => {
    expect(unified(lineDiff(long, long))).toEqual(["  …"]);
  });
});
