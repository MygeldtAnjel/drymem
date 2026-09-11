/**
 * The shape of a memory, read back out of its markdown.
 *
 * The body is stored as one string, deliberately: five columns would have made
 * every memory written before today unreadable and every memory written by a
 * tool that does not know the template unwritable. So the structure is a
 * *convention*, recovered here — an entry that follows it gets labelled
 * sections, one that does not still reads as prose.
 *
 * This mirrors `drymem_server/schema.py`. The server owns the canonical list
 * and serves it at `/v1/memories/schema`; this copy exists because the reader
 * must not wait on a round trip to know how to lay out a page.
 */

export const SECTIONS = ["Summary", "Why", "Where", "Key details", "Learned"] as const;

export interface Section {
  heading: string;
  body: string;
  /** The template section this heading means, or null when it is the author's own. */
  canonical: string | null;
}

const ALIASES: Record<string, string> = {
  summary: "Summary",
  what: "Summary",
  why: "Why",
  problem: "Why",
  problemstatement: "Why",
  context: "Why",
  where: "Where",
  files: "Where",
  affectedfiles: "Where",
  keydetails: "Key details",
  keydetail: "Key details",
  details: "Key details",
  solution: "Key details",
  learned: "Learned",
  learnings: "Learned",
  keylearnings: "Learned",
  lessons: "Learned",
  lessonslearned: "Learned",
};

export function canonical(heading: string): string | null {
  const key = heading.trim().replace(/:$/, "").toLowerCase().replace(/[\s-]/g, "");
  return ALIASES[key] ?? null;
}

// A heading is `## Why`, `**Why**` or `**Why:**`. The bold form is capped much
// shorter than the hash form, or every emphasised sentence splits the body.
const HASH = /^\s*#{1,4}\s+([^\n#]{1,160}?)\s*$/;
const BOLD = /^\s*\*\*([^\n*]{1,60}?)\*\*\s*:?\s*$/;

export function split(body: string): { lead: string; sections: Section[] } {
  const lead: string[] = [];
  const sections: { heading: string; body: string[] }[] = [];

  for (const line of body.split("\n")) {
    const match = HASH.exec(line) ?? BOLD.exec(line);
    const heading = match?.[1]?.trim().replace(/:$/, "");
    if (heading && heading !== "---") {
      sections.push({ heading, body: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.body.push(line);
    } else {
      lead.push(line);
    }
  }

  return {
    lead: lead.join("\n").trim(),
    sections: sections.map((s) => ({
      heading: s.heading,
      body: s.body.join("\n").trim(),
      canonical: canonical(s.heading),
    })),
  };
}

/** Each type and the question it answers. Order is the order they appear in. */
export const MEMORY_TYPES: Record<string, string> = {
  decision: "Why it is done this way",
  architecture: "How this part is put together",
  bugfix: "What broke, and what fixed it",
  discovery: "Something true nobody had written down",
  convention: "How this team does this",
  note: "Worth not losing",
};

/** Kept as an alias because chips and filters both read it. */
export const TYPES = MEMORY_TYPES;
