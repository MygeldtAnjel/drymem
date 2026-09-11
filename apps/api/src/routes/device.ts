/**
 * `drymem login` — the browser hand-off.
 *
 * The CLI holds a long random device code and shows the person a short one. The
 * person confirms the short code in a browser where they are already signed in,
 * and the CLI collects a token on its next poll. Nobody types a token, and the
 * only thing that travels over the shoulder is eight characters that are
 * useless without the device code.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { record } from "../lib/audit.js";
import { apiToken, hashToken, randomToken, userCode } from "../lib/crypto.js";
import { badRequest } from "../lib/errors.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const deviceRouter = Router();

const MINUTES = 15;

deviceRouter.post("/", async (req, res) => {
  const body = z.object({ label: z.string().max(200).optional().default("") }).parse(req.body);
  const device = randomToken();
  const [row] = await db
    .insert(schema.deviceCodes)
    .values({
      deviceHash: hashToken(device),
      userCode: userCode(),
      label: body.label.slice(0, 200) || null,
      expiresAt: new Date(Date.now() + MINUTES * 60_000),
    })
    .returning();

  res.json({
    device_code: device,
    user_code: row!.userCode,
    verification_url: `${env.PUBLIC_URL.replace(/\/+$/, "")}/#/device/${row!.userCode}`,
    expires_in: MINUTES * 60,
    interval: 3,
  });
});

deviceRouter.post("/approve", requireUser, async (req, res) => {
  const principal = principalOf(req);
  const body = z.object({ user_code: z.string().max(12) }).parse(req.body);

  const [row] = await db
    .select()
    .from(schema.deviceCodes)
    .where(eq(schema.deviceCodes.userCode, body.user_code.trim().toUpperCase()))
    .limit(1);

  if (!row || row.status !== "pending" || row.expiresAt.getTime() < Date.now()) {
    throw badRequest("That code is not valid any more. Run `drymem login` again.");
  }

  const token = apiToken();
  await db.insert(schema.apiTokens).values({
    userId: principal.userId,
    tokenHash: hashToken(token),
    label: row.label ?? "drymem login",
  });
  await db
    .update(schema.deviceCodes)
    .set({ status: "approved", userId: principal.userId, issuedToken: token })
    .where(eq(schema.deviceCodes.id, row.id));

  await record(principal, "device.approve", row.label ?? row.userCode);
  res.status(204).end();
});

deviceRouter.post("/token", async (req, res) => {
  const body = z.object({ device_code: z.string().max(200) }).parse(req.body);
  const [row] = await db
    .select()
    .from(schema.deviceCodes)
    .where(eq(schema.deviceCodes.deviceHash, hashToken(body.device_code)))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    res.json({ status: "expired", token: null });
    return;
  }
  if (row.status !== "approved" || !row.issuedToken) {
    res.json({ status: row.status, token: null });
    return;
  }

  // Handed over exactly once: clearing it here means a stolen device code is
  // worthless the moment the real CLI has collected.
  await db
    .update(schema.deviceCodes)
    .set({ status: "collected", issuedToken: null })
    .where(eq(schema.deviceCodes.id, row.id));
  res.json({ status: "approved", token: row.issuedToken });
});
