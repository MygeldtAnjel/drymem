/**
 * Reading a skill's frontmatter.
 *
 * The description is the one line a person reads in the catalogue before
 * deciding whether to install something on everyone's laptop, so it has to
 * arrive as prose rather than as YAML.
 */

import { describe, expect, it } from "vitest";

import { descriptionOf } from "../src/lib/frontmatter.js";

const wrap = (line: string) => `---\nname: x\n${line}\n---\n\nBody.\n`;

describe("the description", () => {
  it("takes the plain form", () => {
    expect(descriptionOf(wrap("description: Use when reviewing a branch."))).toBe(
      "Use when reviewing a branch.",
    );
  });

  it("unwraps the quotes YAML needs around a colon", () => {
    // Almost every real description has a colon in it, so almost every real
    // description is quoted — and every card was starting with a stray `"`.
    const out = descriptionOf(wrap('description: "Two axes: Standards and Spec."'));
    expect(out).toBe("Two axes: Standards and Spec.");
  });

  it("unescapes the inner quotes", () => {
    const out = descriptionOf(wrap('description: "Or asks to \\"review since X\\"."'));
    expect(out).toBe('Or asks to "review since X".');
  });

  it("handles the single-quoted form too", () => {
    expect(descriptionOf(wrap("description: 'It''s about retries.'"))).toBe(
      "It's about retries.",
    );
  });

  it("leaves an unbalanced quote alone rather than eating a character", () => {
    expect(descriptionOf(wrap('description: "Unclosed for some reason'))).toBe(
      '"Unclosed for some reason',
    );
  });

  it("is empty when there is no frontmatter at all", () => {
    expect(descriptionOf("Just prose.\n")).toBe("");
    expect(descriptionOf(wrap("name: only"))).toBe("");
  });
});
