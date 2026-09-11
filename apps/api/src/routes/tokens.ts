/** API tokens: what CI and other machines use when there is no browser. */

import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { record } from "../lib/audit.js";
import { apiToken, hashToken } from "../lib/crypto.js";
import { notFound } from "../lib/errors.js";
import { param } from "../lib/params.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const tokenRouter = Router();

tokenRouter.use(requireUser);

tokenRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const rows = await db
    .select()
    .from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.userId, principal.userId), isNull(schema.apiTokens.revokedAt)))
    .orderBy(desc(schema.apiTokens.createdAt));
  res.json(
    rows.map((t) => ({
      id: t.id,
      label: t.label,
      created_at: t.createdAt,
      last_used_at: t.lastUsedAt,
    })),
  );
});

tokenRouter.post("/", async (req, res) => {
  const principal = principalOf(req);
  const body = z.object({ label: z.string().max(200).optional().default("") }).parse(req.body);
  const token = apiToken();
  const [row] = await db
    .insert(schema.apiTokens)
    .values({
      userId: principal.userId,
      tokenHash: hashToken(token),
      label: body.label.trim() || null,
    })
    .returning();

  await record(principal, "token.create", row!.label ?? row!.id);
  // The only time the plaintext exists outside the caller's machine.
  res.json({
    id: row!.id,
    label: row!.label,
    created_at: row!.createdAt,
    last_used_at: null,
    token,
  });
});

tokenRouter.delete("/:id", async (req, res) => {
  const principal = principalOf(req);
  const [row] = await db
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.apiTokens.id, param(req, "id")), eq(schema.apiTokens.userId, principal.userId)),
    )
    .returning();
  if (!row) throw notFound("No such token.");
  await record(principal, "token.revoke", row.label ?? row.id);
  res.status(204).end();
});
