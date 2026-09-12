/**
 * The markdown renderer.
 *
 * These exist because it broke silently once: its styles lived in a global
 * stylesheet, the stylesheet was replaced during a redesign, and every memory
 * body rendered as flat unstyled text with nothing failing anywhere. Styling is
 * now emitted inline, and asserted here.
 */

import { describe, expect, it } from "vitest";

import { frontmatter } from "../src/memory";

/** Render to HTML without a DOM: the component is a pure string builder. */
async function render(source: string): Promise<string> {
  const { Markdown } = await import("../src/Markdown");
  const element = Markdown({ source }) as unknown as {
    props: { dangerouslySetInnerHTML: { __html: string } };
  };
  return element.props.dangerouslySetInnerHTML.__html;
}

describe("Markdown", () => {
  it("gives every block a class, so no stylesheet can take them away", async () => {
    const html = await render("## Heading\n\ntext\n\n- one\n- two");
    expect(html).toContain('<h3 class="');
    expect(html).toContain('<p class="');
    expect(html).toContain('<ul class="');
    expect(html).toContain("list-disc");
  });

  it("escapes markup an agent wrote", async () => {
    const html = await render('a <script>alert("x")</script> b');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps quotes out of a link's href", async () => {
    const html = await render('[x](https://a.test/")onmouseover="alert(1))');
    expect(html).not.toContain('onmouseover="');
  });

  it("renders a closed code fence as a scrollable block", async () => {
    const html = await render("before\n```\ncode here\n```\nafter");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("code here");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("does not let an unclosed fence swallow the document", async () => {
    // A model emitting one stray ``` used to turn a whole skill into a single
    // unreadable code block. A visible backtick is the better failure.
    const html = await render("```\n## Still A Heading\n- still a bullet");
    expect(html).toContain("<h3");
    expect(html).toContain("<ul");
  });

  it("marks a horizontal rule without eating the line after it", async () => {
    const html = await render("---\n\nafter the rule");
    expect(html).toContain("<hr");
    expect(html).toContain("after the rule");
  });
});

describe("frontmatter", () => {
  it("splits a SKILL.md's metadata off its body", () => {
    const { meta, body } = frontmatter(
      "---\nname: retry-backoff\ndescription: When retrying.\n---\n\n## Rules\n- one",
    );
    expect(meta.name).toBe("retry-backoff");
    expect(meta.description).toBe("When retrying.");
    expect(body.startsWith("## Rules")).toBe(true);
  });

  it("drops a stray rule the model left under the frontmatter", () => {
    const { body } = frontmatter("---\nname: x\n---\n\n---\n\n## Rules");
    expect(body.startsWith("## Rules")).toBe(true);
  });

  it("leaves a body with no frontmatter alone", () => {
    const source = "## Just a heading\n\ntext";
    expect(frontmatter(source)).toEqual({ meta: {}, body: source });
  });

  it("does not treat a memory that opens with a rule as frontmatter", () => {
    // `---` with no closing delimiter is a horizontal rule, not metadata.
    const source = "---\nplain prose with no closing marker";
    expect(frontmatter(source).meta).toEqual({});
  });
});

describe("hard-wrapped prose", () => {
  it("joins consecutive lines into one paragraph", async () => {
    // Memory bodies wrap at 80 columns. One <p> per line is what made the
    // memory page look like an unstyled form.
    const html = await render("The plan's three steps are done.\nSkills gained import\nfrom public repos.");
    expect(html.match(/<p /g)?.length).toBe(1);
    expect(html).toContain("done. Skills gained import from public repos.");
  });

  it("still starts a new paragraph on a blank line", async () => {
    const html = await render("First thought.\nStill the first.\n\nA second one.");
    expect(html.match(/<p /g)?.length).toBe(2);
  });

  it("ends the paragraph when a list starts", async () => {
    const html = await render("Here is why:\n- one\n- two");
    expect(html.match(/<p /g)?.length).toBe(1);
    expect(html.match(/<li /g)?.length).toBe(2);
    expect(html.indexOf("<p ")).toBeLessThan(html.indexOf("<ul "));
  });

  it("ends the paragraph when a heading starts", async () => {
    const html = await render("Some prose.\n## Next section");
    expect(html.match(/<p /g)?.length).toBe(1);
    expect(html).toContain("Next section");
  });

  it("does not swallow the line into a code fence", async () => {
    const html = await render("Before.\n```\ncode()\n```\nAfter.");
    expect(html.match(/<p /g)?.length).toBe(2);
    expect(html).toContain("code()");
  });
});
