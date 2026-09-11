/**
 * Credentials.
 *
 * Two shapes, two treatments. A **password** is low-entropy and chosen by a
 * person, so it gets argon2id — the whole point of which is to be slow. A
 * **token** is 32 random bytes, so guessing it is not a threat model and SHA-256
 * is exactly right: argon2 there would add latency to every single request
 * while defending against nothing.
 *
 * Nothing here stores a plaintext. Tokens are shown once and hashed.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

export const TOKEN_PREFIX = "drymem_";
export const MIN_PASSWORD = 10;

export class WeakPassword extends Error {
  constructor() {
    super(`Use at least ${MIN_PASSWORD} characters.`);
  }
}

export async function hashPassword(raw: string): Promise<string> {
  if (raw.length < MIN_PASSWORD) throw new WeakPassword();
  return argonHash(raw);
}

export async function verifyPassword(stored: string | null, raw: string): Promise<boolean> {
  if (!stored) return false;
  try {
    return await argonVerify(stored, raw);
  } catch {
    return false;
  }
}

/** A URL-safe secret for a link or a cookie. Returned once, stored hashed. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** An API token, prefixed so it is recognisable in a log or a paste. */
export function apiToken(): string {
  return TOKEN_PREFIX + randomToken();
}

export function looksLikeApiToken(raw: string): boolean {
  return raw.startsWith(TOKEN_PREFIX) && raw.length > TOKEN_PREFIX.length + 20;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time compare, for the rare case where we hold both sides. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A short code a person reads off one screen and types into another.
 * No 0/O/1/I: they are the characters people get wrong.
 */
export function userCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (const byte of randomBytes(8)) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
