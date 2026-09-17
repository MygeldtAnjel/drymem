/**
 * What this organisation is using, and on what plan.
 *
 * The counters come before the billing, deliberately. Nothing here gates a
 * feature: `subscriptions` says what is *metered*, not what works, and an org
 * with no row is on the free tier rather than broken. Wiring Stripe to numbers
 * nobody has looked at is how a product bills the wrong thing on day one, so
 * the numbers ship first and the charging comes after the pilot.
 *
 * Seats is the one worth thinking about: it counts people who have actually
 * signed in, not people who were invited. Charging for an invitation nobody
 * accepted is the kind of small dishonesty that loses an account.
 */

import { Router } from "express";
import { and, count, eq, gte, isNull, sql as raw } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const usageRouter = Router();
usageRouter.use(requireUser, requireAdmin);

/** The plan row, or the free tier it means when there isn't one. */
async function planOf(orgId: string) {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId))
    .limit(1);
  return {
    plan: row?.plan ?? "free",
    status: row?.status ?? "active",
    seats_paid: row?.seats ?? 0,
    current_period_end: row?.currentPeriodEnd ?? null,
    cancel_at_period_end: row?.cancelAtPeriodEnd ?? false,
    metered: row !== undefined,
  };
}

usageRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const org = principal.orgId;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const one = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;

  const [
    people,
    pendingInvites,
    projects,
    memories,
    memoriesThisMonth,
    shared,
    skills,
    skillVersions,
    skillReads,
    plan,
  ] = await Promise.all([
    one(db.select({ n: count() }).from(schema.users).where(eq(schema.users.orgId, org))),
    one(
      db
        .select({ n: count() })
        .from(schema.invites)
        .where(and(eq(schema.invites.orgId, org), isNull(schema.invites.acceptedAt))),
    ),
    one(db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.orgId, org))),
    one(db.select({ n: count() }).from(schema.memories).where(eq(schema.memories.orgId, org))),
    one(
      db
        .select({ n: count() })
        .from(schema.memories)
        .where(and(eq(schema.memories.orgId, org), gte(schema.memories.createdAt, monthStart))),
    ),
    one(
      db
        .select({ n: raw<number>`count(*) filter (where ${schema.memories.promotedAt} is not null)::int` })
        .from(schema.memories)
        .where(eq(schema.memories.orgId, org)),
    ),
    one(db.select({ n: count() }).from(schema.skills).where(eq(schema.skills.orgId, org))),
    one(
      db
        .select({ n: count() })
        .from(schema.skillVersions)
        .innerJoin(schema.skills, eq(schema.skills.id, schema.skillVersions.skillId))
        .where(eq(schema.skills.orgId, org)),
    ),
    one(db.select({ n: count() }).from(schema.skillUses).where(eq(schema.skillUses.orgId, org))),
    planOf(org),
  ]);

  res.json({
    // Seats are people who signed in, not people who were invited.
    seats_used: people,
    pending_invites: pendingInvites,
    projects,
    memories: { total: memories, this_month: memoriesThisMonth, shared },
    skills: { catalogue: skills, versions: skillVersions, reads: skillReads },
    subscription: plan,
    month_started: monthStart.toISOString(),
  });
});
