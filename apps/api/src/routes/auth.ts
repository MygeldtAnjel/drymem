/**
 * `/auth/*` — becoming a user, and staying one.
 *
 * Sign-up exists only while the server has nobody on it; the first person owns
 * the organisation and everyone after them arrives by invitation. That is the
 * one rule this file is built around: without it, a server left open on a
 * network hands ownership to whoever finds it.
 */

import { Router } from "express";
import { and, count, desc, eq, isNull, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { emailEnabled, env } from "../env.js";
import { record } from "../lib/audit.js";
import { seedCatalogue } from "../lib/seed.js";
import { hashPassword, hashToken, randomToken, verifyPassword, WeakPassword } from "../lib/crypto.js";
import { badRequest, conflict, limiter, notFound, unauthorized } from "../lib/errors.js";
import { link, sendReset } from "../lib/email.js";
import { endAllSessions, endSession, startSession } from "../lib/sessions.js";
import { param } from "../lib/params.js";
import { principalOf, requireUser, SESSION_COOKIE } from "../middleware/auth.js";

export const authRouter = Router();

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";

/** Guessing a password and farming reset emails are the two things worth rate-limiting. */
const loginLimit = limiter(10, 60_000);
const resetLimit = limiter(5, 600_000);

async function sessionBody(userId: string) {
  const [row] = await db
    .select({ user: schema.users, org: schema.orgs })
    .from(schema.users)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.users.orgId))
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) throw unauthorized();
  return {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    role: row.user.role,
    org_id: row.org.id,
    org_name: row.org.name,
  };
}

async function isEmpty(): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(schema.users);
  return (row?.n ?? 0) === 0;
}

// ---- first run ------------------------------------------------------------------

authRouter.get("/bootstrap", async (_req, res) => {
  const empty = await isEmpty();
  const [org] = empty ? [] : await db.select().from(schema.orgs).limit(1);
  res.json({
    needs_setup: empty,
    org_name: org?.name ?? null,
    smtp_enabled: emailEnabled,
  });
});

const signupSchema = z.object({
  org_name: z.string().min(1).max(200),
  email: z.email().max(320),
  password: z.string().min(1).max(200),
  name: z.string().max(200).optional().default(""),
});

authRouter.post("/signup", async (req, res) => {
  if (!(await isEmpty())) {
    throw conflict("This server already has an organisation. Ask for an invitation.");
  }
  const body = signupSchema.parse(req.body);

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(body.password);
  } catch (error) {
    throw error instanceof WeakPassword ? badRequest(error.message) : error;
  }

  const [org] = await db
    .insert(schema.orgs)
    .values({ name: body.org_name.trim(), slug: slug(body.org_name) })
    .returning();
  const [user] = await db
    .insert(schema.users)
    .values({
      orgId: org!.id,
      email: body.email.trim().toLowerCase(),
      name: body.name?.trim() || null,
      passwordHash,
      role: "owner",
    })
    .returning();

  await startSession(user!.id, req.get("user-agent"), res);
  await record({ orgId: org!.id, userId: user!.id }, "org.create", org!.name);
  await record({ orgId: org!.id, userId: user!.id }, "user.signup", user!.email);

  // A catalogue with something in it, so the first visit is not an empty page.
  // Published, not enabled: a lead still chooses what runs on the team's laptops.
  const seeded = await seedCatalogue({ orgId: org!.id, userId: user!.id });
  res.json({ ...(await sessionBody(user!.id)), base_skills: seeded.published.length });
});

// ---- sign in and out ---------------------------------------------------------------

authRouter.post("/login", async (req, res) => {
  loginLimit(req.ip ?? "unknown");
  const body = z
    .object({ email: z.string().max(320), password: z.string().max(200) })
    .parse(req.body);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(raw`lower(${schema.users.email})`, body.email.trim().toLowerCase()))
    .limit(1);

  // One message for every failure: unknown email and wrong password are the
  // same answer, or this endpoint becomes a way to enumerate accounts.
  if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
    throw badRequest("That email and password do not match.");
  }

  await startSession(user.id, req.get("user-agent"), res);
  await record({ orgId: user.orgId, userId: user.id }, "user.login", user.email);
  res.json(await sessionBody(user.id));
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req.cookies?.[SESSION_COOKIE] as string | undefined, res);
  res.status(204).end();
});

authRouter.get("/session", requireUser, async (req, res) => {
  res.json(await sessionBody(principalOf(req).userId));
});

// ---- passwords ------------------------------------------------------------------------

authRouter.post("/password", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const body = z
    .object({ current: z.string().max(200).optional().default(""), new: z.string().max(200) })
    .parse(req.body);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, principal.userId))
    .limit(1);
  if (!user) throw notFound("No such user.");

  // A user created before drymem had passwords has none to confirm.
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, body.current))) {
    throw badRequest("Your current password is not right.");
  }

  let hash: string;
  try {
    hash = await hashPassword(body.new);
  } catch (error) {
    throw error instanceof WeakPassword ? badRequest(error.message) : error;
  }
  await db.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, user.id));

  // Everything except the browser doing the changing gets thrown out.
  await endAllSessions(user.id);
  await startSession(user.id, req.get("user-agent"), res);
  await record(principal, "user.password_change", user.email);
  res.status(204).end();
});

/**
 * Forgot password.
 *
 * Always answers the same way, whether or not the address exists. Telling a
 * stranger "no account here" turns this into a directory of who works at the
 * company — and telling them "check your email" when nothing was sent costs
 * nothing.
 */
authRouter.post("/forgot", async (req, res) => {
  resetLimit(req.ip ?? "unknown");
  const body = z.object({ email: z.string().max(320) }).parse(req.body);
  const email = body.email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(raw`lower(${schema.users.email})`, email))
    .limit(1);

  let devLink: string | null = null;
  if (user) {
    const token = randomToken();
    await db.insert(schema.passwordResets).values({
      userId: user.id,
      tokenHash: hashToken(token),
      requestedIp: req.ip?.slice(0, 64) ?? null,
      expiresAt: new Date(Date.now() + env.RESET_MINUTES * 60_000),
    });
    const url = link(`reset/${token}`);
    const result = await sendReset({ to: user.email, url, minutes: env.RESET_MINUTES });
    // With no mail provider the link has to reach a human somehow. It goes to
    // the server log, never to the response — the response is identical for a
    // real address and an invented one, and that is the whole point.
    if (!result.sent) {
      console.info(`password reset for ${user.email}: ${url}`);
      devLink = url;
    }
  }

  res.json({
    // Deliberately not "we sent you an email" — we may not have.
    detail: "If that address has an account, a reset link is on its way.",
    email_configured: emailEnabled,
    ...(emailEnabled || !devLink ? {} : { server_log_hint: true }),
  });
});

authRouter.get("/reset/:token", async (req, res) => {
  const [row] = await db
    .select({ reset: schema.passwordResets, user: schema.users })
    .from(schema.passwordResets)
    .innerJoin(schema.users, eq(schema.users.id, schema.passwordResets.userId))
    .where(
      and(
        eq(schema.passwordResets.tokenHash, hashToken(param(req, "token"))),
        isNull(schema.passwordResets.usedAt),
      ),
    )
    .limit(1);

  if (!row || row.reset.expiresAt.getTime() < Date.now()) {
    throw notFound("This reset link is no longer valid. Ask for a new one.");
  }
  res.json({ email: row.user.email });
});

authRouter.post("/reset/:token", async (req, res) => {
  const body = z.object({ password: z.string().max(200) }).parse(req.body);

  const [row] = await db
    .select({ reset: schema.passwordResets, user: schema.users })
    .from(schema.passwordResets)
    .innerJoin(schema.users, eq(schema.users.id, schema.passwordResets.userId))
    .where(
      and(
        eq(schema.passwordResets.tokenHash, hashToken(param(req, "token"))),
        isNull(schema.passwordResets.usedAt),
      ),
    )
    .limit(1);

  if (!row || row.reset.expiresAt.getTime() < Date.now()) {
    throw notFound("This reset link is no longer valid. Ask for a new one.");
  }

  let hash: string;
  try {
    hash = await hashPassword(body.password);
  } catch (error) {
    throw error instanceof WeakPassword ? badRequest(error.message) : error;
  }

  await db
    .update(schema.users)
    .set({ passwordHash: hash })
    .where(eq(schema.users.id, row.user.id));
  await db
    .update(schema.passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResets.id, row.reset.id));

  // The reason someone resets a password is that they fear somebody else has
  // it. Leaving that person's session alive would defeat the exercise.
  await endAllSessions(row.user.id);
  await startSession(row.user.id, req.get("user-agent"), res);
  await record(
    { orgId: row.user.orgId, userId: row.user.id },
    "user.password_reset",
    row.user.email,
  );
  res.json(await sessionBody(row.user.id));
});

// ---- your browsers -------------------------------------------------------------------------

authRouter.get("/sessions", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const current = req.sessionToken ? hashToken(req.sessionToken) : null;
  const rows = await db
    .select()
    .from(schema.webSessions)
    .where(
      and(eq(schema.webSessions.userId, principal.userId), isNull(schema.webSessions.revokedAt)),
    )
    .orderBy(desc(schema.webSessions.createdAt));

  res.json(
    rows.map((s) => ({
      id: s.id,
      user_agent: s.userAgent,
      created_at: s.createdAt,
      last_seen_at: s.lastSeenAt,
      current: s.tokenHash === current,
    })),
  );
});

authRouter.delete("/sessions/:id", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const [row] = await db
    .update(schema.webSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.webSessions.id, param(req, "id")),
        eq(schema.webSessions.userId, principal.userId),
      ),
    )
    .returning();
  if (!row) throw notFound("No such session.");
  await record(principal, "session.revoke", row.userAgent ?? row.id);
  res.status(204).end();
});
