/**
 * Putting a version into the catalogue.
 *
 * Lives here rather than in the route because two callers need it: a person
 * publishing over HTTP, and the seeder that fills a brand-new organisation's
 * catalogue on signup. They must agree on every rule — the scan, the slug, the
 * content-addressing — or a bundled skill would arrive by a path that skipped
 * the checks a published one goes through.
 */

import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { record } from "./audit.js";
import { descriptionOf } from "./frontmatter.js";
import { rejects, scan } from "./scan.js";
import type { Finding } from "../db/schema.js";

export const sha = (content: string, files: Record<string, string>) =>
  createHash("sha256")
    .update(content)
    .update(JSON.stringify(Object.entries(files).sort()))
    .digest("hex");

/** A name a filesystem and an agent will both accept. */
export const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export interface PublishInput {
  name: string;
  content: string;
  files: Record<string, string>;
  topic: string;
  description: string;
  model?: string | null;
  memory_count: number;
  source: "base" | "distilled" | "imported" | "authored";
  origin?: string | null;
  note: string;
}

export type PublishResult =
  | { outcome: "rejected"; findings: Finding[] }
  | { outcome: "unchanged"; name: string; skillId: string; version: number; findings: Finding[] }
  | {
      outcome: "published";
      name: string;
      skillId: string;
      versionId: string;
      version: number;
      sha256: string;
      state: "pending" | "published";
      findings: Finding[];
    };

async function latest(skillId: string) {
  const [row] = await db
    .select()
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skillId))
    .orderBy(desc(schema.skillVersions.version))
    .limit(1);
  return row;
}

export async function publishVersion(
  who: { orgId: string; userId: string },
  input: PublishInput,
): Promise<PublishResult> {
  const name = slug(input.name);
  /*
   * A skill describes itself. Its frontmatter carries the sentence an agent
   * reads to decide whether to load it, which is the same sentence a person
   * reads in the catalogue — so a caller that sends no description gets that
   * one rather than a card saying "No description".
   */
  const description = input.description || descriptionOf(input.content);
  const findings = scan(input.content, input.files);
  if (rejects(findings)) return { outcome: "rejected", findings };

  const [existing] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.orgId, who.orgId), eq(schema.skills.name, name)))
    .limit(1);

  const state = findings.length > 0 ? "pending" : "published";
  let skill = existing;
  if (!skill) {
    [skill] = await db
      .insert(schema.skills)
      .values({
        orgId: who.orgId,
        authorId: who.userId,
        name,
        topic: input.topic,
        description: description || input.topic || null,
        scope: "org",
        source: input.source,
        origin: input.origin ?? null,
        state,
      })
      .returning();
  } else {
    [skill] = await db
      .update(schema.skills)
      .set({
        topic: input.topic || skill.topic,
        description: description || skill.description,
        // A skill that was deprecated and is published again is alive.
        state,
        updatedAt: new Date(),
      })
      .where(eq(schema.skills.id, skill.id))
      .returning();
  }

  const previous = await latest(skill!.id);
  const digest = sha(input.content, input.files);
  if (previous?.sha256 === digest) {
    // Identical bytes are the same version. Publishing twice by accident
    // should not litter the history with copies.
    return {
      outcome: "unchanged",
      name: skill!.name,
      skillId: skill!.id,
      version: previous.version,
      findings,
    };
  }

  const [version] = await db
    .insert(schema.skillVersions)
    .values({
      skillId: skill!.id,
      version: (previous?.version ?? 0) + 1,
      content: input.content,
      files: input.files,
      sha256: digest,
      model: input.model ?? null,
      memoryCount: input.memory_count,
      findings,
      createdBy: who.userId,
      note: input.note || null,
    })
    .returning();

  await record(who, "skill.publish", `${skill!.name}@${version!.version}`);

  return {
    outcome: "published",
    name: skill!.name,
    skillId: skill!.id,
    versionId: version!.id,
    version: version!.version,
    sha256: version!.sha256,
    state,
    findings,
  };
}
