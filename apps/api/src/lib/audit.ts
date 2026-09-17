/**
 * The record of who did what.
 *
 * Written on the way out of every action that changes shared state. It never
 * carries a secret — a scrubber hit records *which rule fired*, never the value
 * it matched — and never carries content, because content would make this a
 * transcript (PLAN.md D30, D35).
 *
 * Failing to write an audit row must not fail the action it describes: losing a
 * memory to protect its log entry is the wrong way round.
 */

import { db, schema } from "../db/client.js";
import type { Principal } from "./principal.js";

export type Action =
  | "org.create"
  | "user.signup"
  | "user.login"
  | "user.password_change"
  | "user.password_reset"
  | "user.rename"
  | "member.invite"
  | "member.invite_revoke"
  | "member.join"
  | "member.add"
  | "member.remove"
  | "member.role"
  | "project.create"
  | "project.rename"
  | "project.capture_mode"
  | "token.create"
  | "token.revoke"
  | "session.revoke"
  | "device.approve"
  | "skill.publish"
  | "skill.enable"
  | "skill.disable"
  | "skill.approve"
  | "skill.deprecate"
  | "skill.import"
  // Who was let into the product, and who let them in.
  | "access.approved"
  | "access.declined"
  | "access.pending";

export async function record(
  principal: Pick<Principal, "orgId" | "userId"> | { orgId: string; userId: string | null },
  action: Action,
  target?: string,
): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      orgId: principal.orgId,
      actorId: principal.userId ?? null,
      action,
      target: target ?? null,
    });
  } catch (error) {
    console.warn(`audit ${action} not recorded: ${String(error)}`);
  }
}
