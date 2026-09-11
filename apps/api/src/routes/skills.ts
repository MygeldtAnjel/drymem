/**
 * The skills a project has published.
 *
 * Registry CRUD, which is why it lives here and not in the engine: nothing on
 * this path needs a model. Drafting one *does* — `discover` and `distill` are
 * forwarded to Python by the catch-all that runs after this router.
 *
 * Step C replaces this with a real catalogue: versions, scopes, scanning, a
 * lockfile in the repo. The shape below is deliberately the smallest thing that
 * keeps today's memory→skill loop working while that is built.
 */

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { record } from "../lib/audit.js";
import { forbidden, notFound } from "../lib/errors.js";
import { isAdmin, type Principal } from "../lib/principal.js";
import { param } from "../lib/params.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const skillRouter = Router();

async function asLead(principal: Principal, key: string) {
  const [row] = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projects.projectKey, key),
        eq(schema.projects.orgId, principal.orgId),
        eq(schema.projectMembers.userId, principal.userId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("No such project.");
  if (row.role !== "lead" && !isAdmin(principal)) {
    throw forbidden("Only a project lead or an organisation admin can publish a skill.");
  }
  return row.project;
}

skillRouter.get("/", requireUser, async (req, res) => {
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
  if (!project) {
    res.json({ project_key: query.project_key, skills: [] });
    return;
  }

  const rows = await db
    .select({ skill: schema.skills, author: schema.users.email })
    .from(schema.skills)
    .innerJoin(schema.users, eq(schema.users.id, schema.skills.authorId))
    .where(eq(schema.skills.projectId, project.id))
    .orderBy(desc(schema.skills.updatedAt));

  res.json({
    project_key: query.project_key,
    skills: rows.map((r) => ({
      id: r.skill.id,
      name: r.skill.name,
      topic: r.skill.topic,
      content: r.skill.content,
      author: r.author,
      model: r.skill.model,
      memory_count: r.skill.memoryCount,
      updated_at: r.skill.updatedAt,
    })),
  });
});

const publishSchema = z.object({
  project_key: z.string().max(500),
  name: z.string().min(1).max(200),
  topic: z.string().max(300).optional().default(""),
  content: z.string().min(1),
  model: z.string().max(100).nullish(),
  memory_count: z.number().int().min(0).optional().default(0),
});

skillRouter.post("/", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const body = publishSchema.parse(req.body);
  const project = await asLead(principal, body.project_key);

  // Publishing the same name again replaces it. Two answers to one subject is
  // the state this product exists to prevent.
  const [saved] = await db
    .insert(schema.skills)
    .values({
      orgId: principal.orgId,
      projectId: project.id,
      authorId: principal.userId,
      name: body.name,
      topic: body.topic,
      content: body.content,
      model: body.model ?? null,
      memoryCount: body.memory_count,
    })
    .onConflictDoUpdate({
      target: [schema.skills.projectId, schema.skills.name],
      set: {
        topic: body.topic,
        content: body.content,
        model: body.model ?? null,
        memoryCount: body.memory_count,
        authorId: principal.userId,
        updatedAt: new Date(),
      },
    })
    .returning();

  await record(principal, "member.add", `skill ${body.name} in ${body.project_key}`);
  res.json({
    id: saved!.id,
    name: saved!.name,
    topic: saved!.topic,
    content: saved!.content,
    author: principal.email,
    model: saved!.model,
    memory_count: saved!.memoryCount,
    updated_at: saved!.updatedAt,
  });
});

skillRouter.delete("/:name", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);
  const project = await asLead(principal, query.project_key);

  const [row] = await db
    .delete(schema.skills)
    .where(and(eq(schema.skills.projectId, project.id), eq(schema.skills.name, param(req, "name"))))
    .returning();
  if (!row) throw notFound("No such skill.");
  res.json({ episode_uuid: row.name, deleted: true });
});
