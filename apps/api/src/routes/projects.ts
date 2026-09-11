/**
 * Projects and who is on them.
 *
 * A project is a repository, keyed by its normalised git remote. The key is
 * never editable: it is what makes two people cloning the same repo land in the
 * same memory, and renaming it would split a team in half.
 *
 * Roles are checked here, in the service, not in the UI. A hidden button is not
 * a permission.
 */

import { Router } from "express";
import { and, countDistinct, eq, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { record } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { isAdmin, type Principal } from "../lib/principal.js";
import { param } from "../lib/params.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const projectRouter = Router();
projectRouter.use(requireUser);

/** The project, only if the caller is on it — otherwise 404, never 403.
 *  A 403 would confirm the project exists, which leaks one org's repo names. */
async function visible(principal: Principal, key: string) {
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
  return row;
}

async function asLead(principal: Principal, key: string) {
  const row = await visible(principal, key);
  if (row.role !== "lead" && !isAdmin(principal)) {
    throw forbidden("Only a project lead or an organisation admin can do that.");
  }
  return row.project;
}

async function membersOf(project: { id: string; projectKey: string }) {
  const rows = await db
    .select({ user: schema.users, role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.projectMembers.projectId, project.id))
    .orderBy(schema.users.email);
  return {
    project_key: project.projectKey,
    members: rows.map((r) => ({ user_id: r.user.id, email: r.user.email, role: r.role })),
  };
}

projectRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const rows = await db
    .select({
      project: schema.projects,
      memories: countDistinct(schema.memories.id),
      positive: raw<number>`count(distinct ${schema.memoryFeedback.id}) filter (where ${schema.memoryFeedback.rating} > 0)`,
      negative: raw<number>`count(distinct ${schema.memoryFeedback.id}) filter (where ${schema.memoryFeedback.rating} < 0)`,
      role: schema.projectMembers.role,
    })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .leftJoin(schema.memories, eq(schema.memories.projectId, schema.projects.id))
    .leftJoin(schema.memoryFeedback, eq(schema.memoryFeedback.memoryId, schema.memories.id))
    .where(
      and(
        eq(schema.projects.orgId, principal.orgId),
        eq(schema.projectMembers.userId, principal.userId),
      ),
    )
    .groupBy(schema.projects.id, schema.projectMembers.role)
    .orderBy(schema.projects.projectKey);

  res.json({
    projects: rows.map((r) => ({
      id: r.project.id,
      project_key: r.project.projectKey,
      display_name: r.project.displayName,
      capture_mode: r.project.captureMode,
      your_role: r.role,
      memory_count: Number(r.memories),
      positive: Number(r.positive),
      negative: Number(r.negative),
    })),
  });
});

projectRouter.get("/*key/members", async (req, res) => {
  const principal = principalOf(req);
  const { project } = await visible(principal, param(req, "key"));
  res.json(await membersOf(project));
});

projectRouter.post("/*key/members", async (req, res) => {
  const principal = principalOf(req);
  const project = await asLead(principal, param(req, "key"));
  const body = z.object({ email: z.string().max(320) }).parse(req.body);

  const [invitee] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(raw`lower(${schema.users.email})`, body.email.trim().toLowerCase()),
        eq(schema.users.orgId, principal.orgId),
      ),
    )
    .limit(1);
  if (!invitee) throw notFound("No such person in this organisation. Invite them first.");

  await db
    .insert(schema.projectMembers)
    .values({ projectId: project.id, userId: invitee.id, role: "member" })
    .onConflictDoNothing();
  await record(principal, "member.add", `${project.projectKey}:${invitee.email}`);

  res.json(await membersOf(project));
});

projectRouter.patch("/*key/members/:email", async (req, res) => {
  const principal = principalOf(req);
  const project = await asLead(principal, param(req, "key"));
  const body = z.object({ role: z.enum(["lead", "member"]) }).parse(req.body);

  const [member] = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(
      and(
        eq(schema.projectMembers.projectId, project.id),
        eq(raw`lower(${schema.users.email})`, param(req, "email").toLowerCase()),
      ),
    )
    .limit(1);
  if (!member) throw notFound("They are not on this project.");

  await db
    .update(schema.projectMembers)
    .set({ role: body.role })
    .where(eq(schema.projectMembers.id, member.id));
  await record(principal, "member.role", `${project.projectKey}:${param(req, "email")}=${body.role}`);
  res.json(await membersOf(project));
});

projectRouter.delete("/*key/members/:email", async (req, res) => {
  const principal = principalOf(req);
  const project = await asLead(principal, param(req, "key"));

  const current = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, project.id));
  // A project with nobody on it cannot be opened by anyone, including whoever
  // would have to fix that.
  if (current.length <= 1) throw conflict("A project must keep at least one member.");

  const [member] = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(
      and(
        eq(schema.projectMembers.projectId, project.id),
        eq(raw`lower(${schema.users.email})`, param(req, "email").toLowerCase()),
      ),
    )
    .limit(1);
  if (!member) throw notFound("They are not on this project.");

  await db.delete(schema.projectMembers).where(eq(schema.projectMembers.id, member.id));
  await record(principal, "member.remove", `${project.projectKey}:${param(req, "email")}`);
  res.json(await membersOf(project));
});

projectRouter.patch("/*key", async (req, res) => {
  const principal = principalOf(req);
  const project = await asLead(principal, param(req, "key"));
  const body = z
    .object({
      display_name: z.string().max(200).optional(),
      capture_mode: z.enum(["automatic", "ask", "manual"]).optional(),
    })
    .parse(req.body);

  if (body.display_name === undefined && body.capture_mode === undefined) {
    throw badRequest("Nothing to change.");
  }

  const [updated] = await db
    .update(schema.projects)
    .set({
      ...(body.display_name !== undefined
        ? { displayName: body.display_name.trim() || null }
        : {}),
      ...(body.capture_mode !== undefined ? { captureMode: body.capture_mode } : {}),
    })
    .where(eq(schema.projects.id, project.id))
    .returning();

  if (body.display_name !== undefined) {
    await record(principal, "project.rename", `${project.projectKey} -> ${body.display_name}`);
  }
  if (body.capture_mode !== undefined) {
    await record(
      principal,
      "project.capture_mode",
      `${project.projectKey} -> ${body.capture_mode}`,
    );
  }

  res.json({
    id: updated!.id,
    project_key: updated!.projectKey,
    display_name: updated!.displayName,
    capture_mode: updated!.captureMode,
  });
});
