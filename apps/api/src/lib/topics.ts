/**
 * Asking the engine what a skill is about.
 *
 * The model lives in the Python engine; this app owns the row. Tagging happens
 * *after* a publish has committed, deliberately: a skill with no tags is a
 * slightly worse catalogue card, but a publish that fails because the tagger
 * was slow is somebody's blocked work. Nothing here may throw into a request.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { signPrincipal, type Principal } from "./principal.js";

/**
 * Long enough for a cold local model, short enough that a hung engine does not
 * hold a publish open. Measured: 4s on the first call, under a second warm.
 */
const TIMEOUT_MS = 30_000;

async function derive(principal: Principal, name: string, content: string): Promise<string[]> {
  try {
    const response = await fetch(new URL("/v1/skills/topics", env.MEMORY_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Drymem-Principal": await signPrincipal(principal),
      },
      body: JSON.stringify({ name, content }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { topics?: unknown };
    return Array.isArray(body.topics) ? body.topics.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Tag one skill, if it has none yet.
 *
 * Only when it has none: re-deriving on every version would spend a model call
 * per publish to usually produce the same five words, and a tag somebody has
 * corrected by hand should not be overwritten by the next push.
 */
export async function tagSkill(
  principal: Principal,
  skillId: string,
  name: string,
  content: string,
): Promise<string[]> {
  const [row] = await db
    .select({ topics: schema.skills.topics })
    .from(schema.skills)
    .where(eq(schema.skills.id, skillId))
    .limit(1);
  if (!row || row.topics.length > 0) return row?.topics ?? [];

  const topics = await derive(principal, name, content);
  if (topics.length === 0) return [];

  await db.update(schema.skills).set({ topics }).where(eq(schema.skills.id, skillId));
  return topics;
}
