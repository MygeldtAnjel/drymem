/**
 * Reading route parameters under Express 5.
 *
 * A project key is a git remote — `github.com/acme/payments` — so it spans
 * several path segments and has to be a wildcard. path-to-regexp v8 hands a
 * wildcard back as an array of segments, and every other parameter back as a
 * string that the types still describe as possibly absent. Both are papered
 * over here rather than at each of the dozen call sites.
 */

import type { Request } from "express";

export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value.join("/");
  return value ?? "";
}
