/**
 * Reading the record of who did what.
 *
 * The question this exists to answer, from PLAN.md Step D: *"who enabled this
 * skill, and has anyone pasted a credential this month?"* — both from one
 * screen. So the reader is boring on purpose: filter by action, actor and date,
 * page through it, and a summary of the counts so the answer to the second half
 * is visible without scrolling.
 *
 * Admins only. An audit trail every member can read is a list of what their
 * colleagues have been doing, which is not what it is for.
 */

import { Router } from "express";
import { and, desc, eq, gte, inArray, lt, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const auditRouter = Router();
// Admins only. An audit trail every member can read is a list of what their
// colleagues have been doing.
auditRouter.use(requireUser, requireAdmin);

/**
 * Groups, so a filter is one click rather than knowing every action name.
 * `security` is the one that matters: it is the second half of the question.
 *
 * Two services write here and they named the same concepts differently — the
 * engine says `project.add_member` where this one says `member.add` — so a
 * group lists both spellings rather than silently showing half the events.
 */
export const GROUPS: Record<string, string[]> = {
  security: ["memory.rejected", "memory.scrubbed", "skill.approve", "token.create", "token.revoke"],
  people: [
    "user.signup",
    "user.rename",
    "member.invite",
    "member.invite_revoke",
    "member.join",
    "member.add",
    "member.remove",
    "member.role",
    "project.add_member",
    "project.remove_member",
    "project.set_role",
  ],
  skills: [
    "skill.publish",
    "skill.enable",
    "skill.disable",
    "skill.approve",
    "skill.deprecate",
    "skill.import",
    "skill.update",
    "skill.delete",
  ],
  memories: ["memory.promote", "memory.supersede", "memory.rejected", "memory.scrubbed"],
  projects: ["project.create", "project.rename", "project.capture_mode"],
  access: [
    "user.login",
    "user.password_change",
    "user.password_reset",
    "session.revoke",
    "device.approve",
    "token.create",
    "token.revoke",
  ],
};

const querySchema = z.object({
  group: z.enum(["security", "people", "skills", "memories", "projects", "access"]).optional(),
  action: z.string().max(100).optional(),
  actor: z.string().max(320).optional(),
  since: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  /** The `id` of the last row seen. Ids are monotonic, so this needs no offset. */
  before: z.coerce.number().int().min(1).optional(),
});

auditRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const query = querySchema.parse(req.query);

  const where = [eq(schema.auditLog.orgId, principal.orgId)];
  if (query.group) where.push(inArray(schema.auditLog.action, GROUPS[query.group]!));
  if (query.action) where.push(eq(schema.auditLog.action, query.action));
  if (query.before) where.push(lt(schema.auditLog.id, query.before));
  if (query.since) {
    const at = new Date(query.since);
    if (!Number.isNaN(at.getTime())) where.push(gte(schema.auditLog.createdAt, at));
  }
  if (query.actor) {
    where.push(eq(raw`lower(${schema.users.email})`, query.actor.trim().toLowerCase()));
  }

  // One extra row rather than a count: the page only needs to know whether to
  // offer "older", and counting a growing log on every request is wasteful.
  const rows = await db
    .select({ entry: schema.auditLog, actor: schema.users.email, name: schema.users.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
    .where(and(...where))
    .orderBy(desc(schema.auditLog.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  res.json({
    events: page.map((r) => ({
      id: r.entry.id,
      action: r.entry.action,
      target: r.entry.target,
      actor: r.actor,
      actor_name: r.name,
      created_at: r.entry.createdAt,
    })),
    // Null when there is no next page, so the caller has nothing to decide.
    next_before: rows.length > query.limit ? page[page.length - 1]!.entry.id : null,
  });
});

/** The counts a person actually looks at: what happened, how often, lately. */
auditRouter.get("/summary", async (req, res) => {
  const principal = principalOf(req);
  const days = z.coerce.number().int().min(1).max(365).parse(req.query.days ?? 30);
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await db
    .select({
      action: schema.auditLog.action,
      count: raw<number>`count(*)::int`,
      last_at: raw<string>`max(${schema.auditLog.createdAt})`,
    })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.orgId, principal.orgId), gte(schema.auditLog.createdAt, since)))
    .groupBy(schema.auditLog.action)
    .orderBy(desc(raw`count(*)`));

  const of = (action: string) => rows.find((r) => r.action === action)?.count ?? 0;
  res.json({
    days,
    actions: rows,
    total: rows.reduce((sum, r) => sum + r.count, 0),
    // Answering the question in the plan directly, rather than making an admin
    // add two numbers from a table.
    credentials: { rejected: of("memory.rejected"), redacted: of("memory.scrubbed") },
  });
});
