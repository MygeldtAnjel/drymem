/**
 * The catalogue a new organisation starts with.
 *
 * An empty catalogue is the same cold-start problem memory has: on day one the
 * product asks for work and gives nothing back, so nobody comes back on day
 * two. Signing up therefore lands a base set of general skills — code review,
 * TDD, diagnosing bugs — already published and ready to enable.
 *
 * They are **not** enabled anywhere. Writing eighteen skills into every
 * developer's agent because somebody created an account is exactly the
 * behaviour drymem exists to stop; a lead still chooses.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { descriptionOf } from "./frontmatter.js";
import { publishVersion } from "./publish.js";

/**
 * `packages/skills` in the monorepo, `skills/` next to the bundle in an image.
 * Checked in order rather than assumed: getting it wrong should show up as
 * "no base skills" in a log line, never as a failed signup.
 */
export function baseSkillsDir(from = fileURLToPath(import.meta.url)): string | null {
  const here = dirname(from);
  const candidates = [
    join(here, "..", "..", "skills", "general"),
    join(here, "..", "..", "..", "..", "packages", "skills", "general"),
    join(here, "..", "..", "..", "..", "..", "packages", "skills", "general"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function readSkill(dir: string): { content: string; files: Record<string, string> } | null {
  const md = join(dir, "SKILL.md");
  if (!existsSync(md)) return null;

  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "SKILL.md" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (statSync(path).size > 200_000) continue;
    files[entry.name] = readFileSync(path, "utf8");
  }
  return { content: readFileSync(md, "utf8"), files };
}

export interface Seeded {
  published: string[];
  /** Held for review — a base skill that mentions `.env` trips the scanner. */
  pending: string[];
  skipped: string[];
}

/**
 * Fill a new organisation's catalogue. Never throws: a signup that works is
 * worth more than a catalogue that is complete.
 */
export async function seedCatalogue(
  who: { orgId: string; userId: string },
  dir: string | null = baseSkillsDir(),
): Promise<Seeded> {
  const seeded: Seeded = { published: [], pending: [], skipped: [] };
  if (!dir) return seeded;

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    try {
      const skill = readSkill(join(dir, entry.name));
      if (!skill) {
        seeded.skipped.push(entry.name);
        continue;
      }
      const result = await publishVersion(who, {
        name: entry.name,
        content: skill.content,
        files: skill.files,
        topic: "",
        description: descriptionOf(skill.content),
        memory_count: 0,
        source: "base",
        note: "Bundled with drymem",
      });
      if (result.outcome === "published" && result.state === "published") {
        seeded.published.push(entry.name);
      } else if (result.outcome === "published") {
        seeded.pending.push(entry.name);
      } else {
        seeded.skipped.push(entry.name);
      }
    } catch {
      // One unreadable folder must not cost the other seventeen.
      seeded.skipped.push(entry.name);
    }
  }
  return seeded;
}
