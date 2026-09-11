/**
 * Who the caller is, and how the Python service comes to believe it.
 *
 * This app is the only thing that talks to a browser or a CLI. The memory
 * engine sits behind it and never faces the internet, so it does not
 * re-authenticate anybody: it is handed a short-lived JWT, signed with a secret
 * the two share, that names the principal. Ninety seconds is long enough for a
 * proxied request and short enough that a leaked one is worthless.
 *
 * The alternative — Python reading the sessions table too — would put identity
 * in two places and guarantee they drift.
 */

import { SignJWT, jwtVerify } from "jose";

import { env } from "../env.js";

export interface Principal {
  userId: string;
  orgId: string;
  email: string;
  /** Organisation role: owner · admin · member. */
  role: string;
}

export const isAdmin = (p: Principal): boolean => p.role === "owner" || p.role === "admin";

const secret = new TextEncoder().encode(env.SERVICE_SECRET);

export async function signPrincipal(principal: Principal): Promise<string> {
  return new SignJWT({ ...principal })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("drymem-api")
    .setAudience("drymem-memory")
    .setIssuedAt()
    .setExpirationTime("90s")
    .sign(secret);
}

/** Only used by our own tests; Python is the real verifier. */
export async function verifyPrincipal(token: string): Promise<Principal> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: "drymem-api",
    audience: "drymem-memory",
  });
  return {
    userId: String(payload.userId),
    orgId: String(payload.orgId),
    email: String(payload.email),
    role: String(payload.role),
  };
}
