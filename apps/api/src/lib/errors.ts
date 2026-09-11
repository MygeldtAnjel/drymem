/**
 * One error shape for the whole API.
 *
 * `detail` is what the person sees, so every message here is written for them
 * rather than for a log. Anything that is *not* an `AppError` is a bug: it is
 * logged in full and reported as a flat 500, because an unplanned error message
 * is exactly the kind that leaks a table name or a file path.
 */

import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new AppError(400, m);
export const unauthorized = (m = "Sign in to continue.") => new AppError(401, m);
export const forbidden = (m = "You do not have permission to do that.") => new AppError(403, m);
export const notFound = (m = "Not found.") => new AppError(404, m);
export const conflict = (m: string) => new AppError(409, m);
export const tooMany = (m = "Too many attempts. Wait a minute and try again.") =>
  new AppError(429, m);

/** Express 5 forwards a rejected promise to `next`, so handlers can be async. */
export function handleErrors(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({ detail: error.message });
    return;
  }
  console.error("unhandled:", error);
  res.status(500).json({ detail: "Something went wrong on our side." });
}

/**
 * A small in-memory limiter for the endpoints worth guessing at.
 *
 * Per process and lost on restart, which is the right trade for a single
 * server: it stops a script, not a determined attacker, and a determined
 * attacker is stopped by argon2 and by 32-byte tokens instead.
 */
export function limiter(max: number, windowMs: number) {
  const seen = new Map<string, { count: number; until: number }>();
  return (key: string): void => {
    const now = Date.now();
    const entry = seen.get(key);
    if (!entry || entry.until < now) {
      seen.set(key, { count: 1, until: now + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > max) throw tooMany();
    // Keep the map from growing without bound on a long-running process.
    if (seen.size > 5000) for (const [k, v] of seen) if (v.until < now) seen.delete(k);
  };
}
