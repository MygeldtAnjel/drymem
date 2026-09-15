/**
 * The browser's section parser.
 *
 * Both implementations read `packages/api-types/fixtures/sections.json`. If one
 * drifts, this suite and the server's `test_schema.py` fail together — which is
 * the point: a memory that splits one way in Python and another in TypeScript
 * reads differently depending on where you opened it.
 */

import { describe, expect, it } from "vitest";

import fixtures from "../../../packages/api-types/fixtures/sections.json";
import { canonical, frontmatter, split } from "../src/memory";

describe("the shared section fixture", () => {
  for (const test of fixtures.cases) {
    it(test.why, () => {
      const { lead, sections } = split(test.body);
      expect(lead).toBe(test.lead);
      expect(sections.map((s) => s.heading)).toEqual(
        test.sections.map((s) => s.heading),
      );
      expect(sections.map((s) => s.canonical)).toEqual(
        test.sections.map((s) => s.canonical),
      );
    });
  }
});

describe("canonical", () => {
  it("maps the headings memories were already written with", () => {
    expect(canonical("Problem Statement")).toBe("Why");
    expect(canonical("Key learnings")).toBe("Learned");
    expect(canonical("Affected files")).toBe("Where");
    expect(canonical("What")).toBe("Summary");
  });

  it("leaves an author's own heading alone", () => {
    expect(canonical("Rollout plan")).toBeNull();
  });
});

describe("split", () => {
  it("keeps a section's body verbatim", () => {
    const { sections } = split("## Where\n- src/a.ts\n- src/b.ts");
    expect(sections[0]!.body).toBe("- src/a.ts\n- src/b.ts");
  });
});

describe("frontmatter", () => {
  it("takes the quotes off a description YAML had to quote", () => {
    // YAML quotes any value with a colon in it, and a skill description almost
    // always has one — so the page printed the quotes and their escapes.
    const source = [
      "---",
      "name: code-review",
      'description: "Review the changes since a fixed point: use when asked to \\"review since X\\"."',
      "---",
      "",
      "# Body",
    ].join("\n");

    const { meta, body } = frontmatter(source);
    expect(meta.description).toBe(
      'Review the changes since a fixed point: use when asked to "review since X".',
    );
    expect(meta.name).toBe("code-review");
    expect(body).toBe("# Body");
  });

  it("leaves an unquoted value exactly as written", () => {
    const { meta } = frontmatter("---\nname: plain\n---\n\nbody");
    expect(meta.name).toBe("plain");
  });
});
