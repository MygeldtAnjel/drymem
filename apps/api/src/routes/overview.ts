/**
 * The numbers a project opens with.
 *
 * Counts from the index, in one round trip, so the dashboard is one request
 * rather than five. Nothing here needs the graph, which is why it is on this
 * side of the wall.
 */

import { Router } from "express";
import { and, countDistinct, eq, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { notFound } from "../lib/errors.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const overviewRouter = Router();

overviewRouter.get("/", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);

  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projects.projectKey, query.project_key),
        eq(schema.projects.orgId, principal.orgId),
        eq(schema.projectMembers.userId, principal.userId),
      ),
    )
    .limit(1);
  if (!project) throw notFound("No such project.");

  const byType = await db
    .select({
      type: schema.memories.memoryType,
      scope: schema.memories.scope,
      n: countDistinct(schema.memories.id),
    })
    .from(schema.memories)
    .where(eq(schema.memories.projectId, project.id))
    .groupBy(schema.memories.memoryType, schema.memories.scope);

  const counts: Record<string, number> = {};
  let memories = 0;
  let shared = 0;
  for (const row of byType) {
    const n = Number(row.n);
    counts[row.type] = (counts[row.type] ?? 0) + n;
    memories += n;
    if (row.scope === "team") shared += n;
  }

  const [sessions] = await db
    .select({ n: raw<number>`count(distinct ${schema.memories.sessionId})` })
    .from(schema.memories)
    .where(
      and(eq(schema.memories.projectId, project.id), raw`${schema.memories.sessionId} is not null`),
    );
  const [members] = await db
    .select({ n: countDistinct(schema.projectMembers.id) })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, project.id));
  const [skills] = await db
    .select({ n: countDistinct(schema.skills.id) })
    .from(schema.skills)
    .where(eq(schema.skills.projectId, project.id));
  const [votes] = await db
    .select({
      positive: raw<number>`count(*) filter (where ${schema.memoryFeedback.rating} > 0)`,
      negative: raw<number>`count(*) filter (where ${schema.memoryFeedback.rating} < 0)`,
    })
    .from(schema.memoryFeedback)
    .innerJoin(schema.memories, eq(schema.memories.id, schema.memoryFeedback.memoryId))
    .where(eq(schema.memories.projectId, project.id));

  res.json({
    project_key: query.project_key,
    memories,
    shared,
    sessions: Number(sessions?.n ?? 0),
    members: Number(members?.n ?? 0),
    skills: Number(skills?.n ?? 0),
    positive: Number(votes?.positive ?? 0),
    negative: Number(votes?.negative ?? 0),
    by_type: counts,
  });
});
