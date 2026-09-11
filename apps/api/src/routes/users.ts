/**
 * People: you, and everyone else in the organisation.
 *
 * The org list carries counts and nothing else. What somebody has written is
 * theirs until they share it, so this can say how much they have filed and must
 * never say what any of it holds.
 */

import { Router } from "express";
import { and, countDistinct, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { record } from "../lib/audit.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { param } from "../lib/params.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const userRouter = Router();
/** `/v1/me` is its own mount: the same handlers at `/`, not at `/me/me`. */
export const meRouter = Router();

userRouter.use(requireUser);
meRouter.use(requireUser);

async function readMe(req: Parameters<typeof principalOf>[0], res: { json: (b: unknown) => void }) {
  const principal = principalOf(req);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, principal.userId))
    .limit(1);
  if (!user) throw notFound("No such user.");
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    org_id: user.orgId,
    role: user.role,
    created_at: user.createdAt,
  });
}

async function renameMe(req: any, res: any) {
  const principal = principalOf(req);
  const body = z.object({ name: z.string().max(200).optional().default("") }).parse(req.body);
  const [user] = await db
    .update(schema.users)
    .set({ name: body.name.trim() || null })
    .where(eq(schema.users.id, principal.userId))
    .returning();
  if (!user) throw notFound("No such user.");
  await record(principal, "user.rename", user.email);
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    org_id: user.orgId,
    role: user.role,
    created_at: user.createdAt,
  });
}

meRouter.get("/", readMe);
meRouter.patch("/", renameMe);
// Kept because the CLI and older bookmarks use them.
userRouter.get("/me", readMe);
userRouter.patch("/me", renameMe);

userRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const rows = await db
    .select({
      user: schema.users,
      memories: countDistinct(schema.memories.id),
      projects: countDistinct(schema.projectMembers.projectId),
    })
    .from(schema.users)
    .leftJoin(schema.memories, eq(schema.memories.authorId, schema.users.id))
    .leftJoin(schema.projectMembers, eq(schema.projectMembers.userId, schema.users.id))
    .where(eq(schema.users.orgId, principal.orgId))
    .groupBy(schema.users.id)
    .orderBy(schema.users.email);

  res.json({
    users: rows.map((r) => ({
      id: r.user.id,
      email: r.user.email,
      name: r.user.name,
      role: r.user.role,
      memory_count: Number(r.memories),
      project_count: Number(r.projects),
      created_at: r.user.createdAt,
      has_password: r.user.passwordHash !== null,
    })),
  });
});

/** Change someone's organisation role. Owners are not demotable by anyone. */
userRouter.patch("/:id/role", requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const body = z.object({ role: z.enum(["admin", "member"]) }).parse(req.body);

  const [target] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, param(req, "id")), eq(schema.users.orgId, principal.orgId)))
    .limit(1);
  if (!target) throw notFound("No such user.");
  if (target.role === "owner") throw forbidden("The owner's role cannot be changed.");
  if (target.id === principal.userId) throw badRequest("You cannot change your own role.");

  const [updated] = await db
    .update(schema.users)
    .set({ role: body.role })
    .where(eq(schema.users.id, target.id))
    .returning();
  await record(principal, "member.role", `${target.email} -> ${body.role}`);
  res.json({ id: updated!.id, email: updated!.email, role: updated!.role });
});

/**
 * Remove someone from the organisation entirely.
 *
 * Their memories stay in the graph under a group nobody now reads, which is the
 * safe half of a delete: an orphaned episode is recoverable, a half-finished
 * cascade across two databases is not.
 */
userRouter.delete("/:id", requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const [target] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, param(req, "id")), eq(schema.users.orgId, principal.orgId)))
    .limit(1);
  if (!target) throw notFound("No such user.");
  if (target.role === "owner") throw forbidden("The owner cannot be removed.");
  if (target.id === principal.userId) throw badRequest("You cannot remove yourself.");

  await db.delete(schema.users).where(eq(schema.users.id, target.id));
  await record(principal, "member.remove", target.email);
  res.status(204).end();
});

/** The audit trail. Admin only, newest first. */
export const auditRouter = Router();
auditRouter.use(requireUser, requireAdmin);

auditRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const query = z
    .object({ limit: z.coerce.number().min(1).max(500).default(100) })
    .parse(req.query);

  const rows = await db
    .select({ event: schema.auditLog, actor: schema.users.email })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
    .where(eq(schema.auditLog.orgId, principal.orgId))
    .orderBy(schema.auditLog.id)
    .limit(query.limit);

  res.json({
    events: rows
      .map((r) => ({
        id: r.event.id,
        action: r.event.action,
        target: r.event.target,
        actor: r.actor,
        created_at: r.event.createdAt,
      }))
      .reverse(),
  });
});

