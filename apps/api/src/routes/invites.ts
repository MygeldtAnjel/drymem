/**
 * Invitations — the only door into an organisation after the first person.
 *
 * The link is emailed when Resend is configured *and* returned to the admin
 * either way. That is not a fallback so much as the primary path on a laptop:
 * a link you paste into Slack always arrives, and an email from a dev key on a
 * shared sending domain frequently does not.
 */

import { Router } from "express";
import { and, desc, eq, isNull, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { record } from "../lib/audit.js";
import { hashPassword, hashToken, randomToken, WeakPassword } from "../lib/crypto.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { link, sendInvite, sendWelcome } from "../lib/email.js";
import { startSession } from "../lib/sessions.js";
import { param } from "../lib/params.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const inviteRouter = Router();

const inviteSchema = z.object({
  email: z.email().max(320),
  role: z.enum(["member", "admin"]).default("member"),
  project_key: z.string().max(500).nullish(),
});

inviteRouter.post("/", requireUser, requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const body = inviteSchema.parse(req.body);
  const email = body.email.trim().toLowerCase();

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.orgId, principal.orgId),
        eq(raw`lower(${schema.users.email})`, email),
      ),
    )
    .limit(1);
  if (existing?.passwordHash) throw conflict(`${email} already has an account here.`);

  let project: typeof schema.projects.$inferSelect | undefined;
  if (body.project_key) {
    [project] = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.orgId, principal.orgId),
          eq(schema.projects.projectKey, body.project_key),
        ),
      )
      .limit(1);
    if (!project) throw notFound("No such project.");
  }

  const token = randomToken();
  const [invite] = await db
    .insert(schema.invites)
    .values({
      orgId: principal.orgId,
      email,
      role: body.role,
      projectId: project?.id ?? null,
      invitedBy: principal.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.INVITE_DAYS * 86_400_000),
    })
    .returning();

  const url = link(`invite/${token}`);
  const [org] = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.id, principal.orgId))
    .limit(1);
  // A name, not an address: "Miguel invited you" is a sentence, and
  // "a.long.address@example.com invited you" is a puzzle (PLAN.md D62).
  const [inviter] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, principal.userId))
    .limit(1);
  const delivery = await sendInvite({
    to: email,
    orgName: org?.name ?? "your team",
    invitedBy: inviter?.name?.trim() || principal.email,
    projectKey: project?.projectKey ?? null,
    role: body.role,
    days: env.INVITE_DAYS,
    url,
  });

  await record(principal, "member.invite", `${email} as ${body.role}`);
  res.json({
    id: invite!.id,
    email: invite!.email,
    role: invite!.role,
    project_key: project?.projectKey ?? null,
    invited_by: principal.email,
    expires_at: invite!.expiresAt,
    invite_url: url,
    emailed: delivery.sent,
    email_error: delivery.reason ?? null,
  });
});

inviteRouter.get("/", requireUser, requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const rows = await db
    .select({
      invite: schema.invites,
      projectKey: schema.projects.projectKey,
      inviter: schema.users.email,
    })
    .from(schema.invites)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.invites.projectId))
    .leftJoin(schema.users, eq(schema.users.id, schema.invites.invitedBy))
    .where(and(eq(schema.invites.orgId, principal.orgId), isNull(schema.invites.acceptedAt)))
    .orderBy(desc(schema.invites.createdAt));

  res.json(
    rows.map((r) => ({
      id: r.invite.id,
      email: r.invite.email,
      role: r.invite.role,
      project_key: r.projectKey,
      invited_by: r.inviter,
      expires_at: r.invite.expiresAt,
    })),
  );
});

inviteRouter.delete("/:id", requireUser, requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const [row] = await db
    .delete(schema.invites)
    .where(and(eq(schema.invites.id, param(req, "id")), eq(schema.invites.orgId, principal.orgId)))
    .returning();
  if (!row) throw notFound("No such invitation.");
  await record(principal, "member.invite_revoke", row.email);
  res.status(204).end();
});

async function liveInvite(token: string) {
  const [row] = await db
    .select({ invite: schema.invites, org: schema.orgs })
    .from(schema.invites)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.invites.orgId))
    .where(and(eq(schema.invites.tokenHash, hashToken(token)), isNull(schema.invites.acceptedAt)))
    .limit(1);
  if (!row || row.invite.expiresAt.getTime() < Date.now()) return null;
  return row;
}

inviteRouter.get("/:token/public", async (req, res) => {
  const row = await liveInvite(param(req, "token"));
  if (!row) throw notFound("This invitation is no longer valid.");

  const [project] = row.invite.projectId
    ? await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, row.invite.projectId))
        .limit(1)
    : [];
  const [inviter] = row.invite.invitedBy
    ? await db.select().from(schema.users).where(eq(schema.users.id, row.invite.invitedBy)).limit(1)
    : [];

  res.json({
    email: row.invite.email,
    org_name: row.org.name,
    project_key: project?.projectKey ?? null,
    invited_by: inviter ? (inviter.name ?? inviter.email) : null,
  });
});

inviteRouter.post("/:token/accept", async (req, res) => {
  const body = z
    .object({ password: z.string().max(200), name: z.string().max(200).optional().default("") })
    .parse(req.body);

  const row = await liveInvite(param(req, "token"));
  if (!row) throw notFound("This invitation is no longer valid. Ask for a new one.");

  let hash: string;
  try {
    hash = await hashPassword(body.password);
  } catch (error) {
    throw error instanceof WeakPassword ? badRequest(error.message) : error;
  }

  // An account may already exist without a password — created by
  // `drymem-admin` before identity did. Claim it rather than duplicating it.
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.orgId, row.invite.orgId),
        eq(raw`lower(${schema.users.email})`, row.invite.email),
      ),
    )
    .limit(1);

  const name = body.name.trim() || existing?.name || null;
  const user = existing
    ? (
        await db
          .update(schema.users)
          .set({
            passwordHash: hash,
            name,
            // An invitation can raise a member to admin. It must never lower an
            // owner — the break-glass link for an existing account comes here too.
            role:
              row.invite.role === "admin" && existing.role === "member" ? "admin" : existing.role,
          })
          .where(eq(schema.users.id, existing.id))
          .returning()
      )[0]!
    : (
        await db
          .insert(schema.users)
          .values({
            orgId: row.invite.orgId,
            email: row.invite.email,
            name,
            passwordHash: hash,
            role: row.invite.role,
          })
          .returning()
      )[0]!;

  if (row.invite.projectId) {
    await db
      .insert(schema.projectMembers)
      .values({ projectId: row.invite.projectId, userId: user.id, role: "member" })
      .onConflictDoNothing();
  }

  await db
    .update(schema.invites)
    .set({ acceptedAt: new Date() })
    .where(eq(schema.invites.id, row.invite.id));

  await startSession(user.id, req.get("user-agent"), res);
  await record({ orgId: user.orgId, userId: user.id }, "member.join", user.email);

  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, user.orgId)).limit(1);

  // Accepting the invitation was the activation step — holding the mailbox is
  // what the link proved. This is the next one: a browser session reads the
  // memory, but nothing writes to it until their agent's machine is connected.
  void sendWelcome({
    to: user.email,
    orgName: org?.name ?? "your team",
    appUrl: link(""),
    owner: false,
  });

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    org_id: user.orgId,
    org_name: org?.name ?? "",
  });
});

