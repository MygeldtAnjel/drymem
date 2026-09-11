/**
 * Turning a request into a principal.
 *
 * Two credentials reach this app. A **session cookie** is what the browser
 * sends; it is httpOnly, revocable, and — because `SameSite=Lax` still permits
 * a cross-site top-level POST — any write with it must also carry
 * `X-Drymem-Client`, which a cross-site form cannot set. A **bearer token** is
 * what the CLI, the hooks and the MCP proxy send; it needs no such guard,
 * because nothing attaches it automatically.
 */

import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { hashToken, looksLikeApiToken } from "../lib/crypto.js";
import { isAdmin, type Principal } from "../lib/principal.js";

export const SESSION_COOKIE = "drymem_session";
export const CLIENT_HEADER = "x-drymem-client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      /** Set when the caller is a browser, so /auth can list "this session". */
      sessionToken?: string;
    }
  }
}

function toPrincipal(user: {
  id: string;
  orgId: string;
  email: string;
  role: string;
}): Principal {
  return { userId: user.id, orgId: user.orgId, email: user.email, role: user.role };
}

async function fromBearer(raw: string): Promise<Principal | null> {
  if (!looksLikeApiToken(raw)) return null;
  const [row] = await db
    .select({ token: schema.apiTokens, user: schema.users })
    .from(schema.apiTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
    .where(
      and(eq(schema.apiTokens.tokenHash, hashToken(raw)), isNull(schema.apiTokens.revokedAt)),
    )
    .limit(1);
  if (!row) return null;

  // Fire and forget: "last used" is worth having and not worth waiting for.
  void db
    .update(schema.apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiTokens.id, row.token.id));

  return toPrincipal(row.user);
}

async function fromCookie(raw: string): Promise<Principal | null> {
  const [row] = await db
    .select({ session: schema.webSessions, user: schema.users })
    .from(schema.webSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.webSessions.userId))
    .where(
      and(eq(schema.webSessions.tokenHash, hashToken(raw)), isNull(schema.webSessions.revokedAt)),
    )
    .limit(1);
  if (!row || row.session.expiresAt.getTime() < Date.now()) return null;

  void db
    .update(schema.webSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.webSessions.id, row.session.id));

  return toPrincipal(row.user);
}

/** Populates `req.principal` when there is a valid credential. Never throws. */
export async function resolvePrincipal(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    req.principal = (await fromBearer(header.slice(7).trim())) ?? undefined;
    return next();
  }

  const cookie = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (cookie) {
    req.principal = (await fromCookie(cookie)) ?? undefined;
    if (req.principal) req.sessionToken = cookie;
  }
  next();
}

/** Requires a principal, and a same-origin marker when the credential is a cookie. */
export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) throw unauthorized();
  const writing = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (writing && req.sessionToken && !req.get(CLIENT_HEADER)) {
    throw forbidden("Cross-site request refused.");
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) throw unauthorized();
  if (!isAdmin(req.principal)) throw forbidden("Only an organisation admin can do that.");
  next();
}

/** After `requireUser`, so the non-null assertion is the truth and not a hope. */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}
