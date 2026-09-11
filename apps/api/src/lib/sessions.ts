/** Creating and ending browser sessions, and the cookie that carries them. */

import type { Response } from "express";
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { hashToken, randomToken } from "./crypto.js";
import { SESSION_COOKIE } from "../middleware/auth.js";

export async function startSession(
  userId: string,
  userAgent: string | undefined,
  res: Response,
): Promise<void> {
  const raw = randomToken();
  await db.insert(schema.webSessions).values({
    userId,
    tokenHash: hashToken(raw),
    userAgent: userAgent?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + env.SESSION_DAYS * 86_400_000),
  });
  res.cookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    maxAge: env.SESSION_DAYS * 86_400_000,
    path: "/",
  });
}

export async function endSession(raw: string | undefined, res: Response): Promise<void> {
  if (raw) {
    await db
      .update(schema.webSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.webSessions.tokenHash, hashToken(raw)));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * End every session a user has.
 *
 * Called when a password changes, by either route. Someone who resets a
 * password because they think it was stolen expects the thief to be thrown out,
 * and a reset that leaves the intruder's session alive does the opposite.
 */
export async function endAllSessions(userId: string): Promise<void> {
  await db
    .update(schema.webSessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.webSessions.userId, userId));
}
