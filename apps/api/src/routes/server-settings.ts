/**
 * The settings an owner can change without opening a shell.
 *
 * Two rules shape this, and both are about what is *not* here.
 *
 * **A secret goes in and never comes back.** The response says whether a key is
 * set and shows its last four characters; it never returns the key. A settings
 * screen that renders its own secrets turns one stolen session into every
 * credential the server holds.
 *
 * **Nothing that decides where the data lives.** The database URLs stay in the
 * environment. A wrong one typed here would take away the browser you would fix
 * it with, and "point drymem at a database I control" should not be reachable
 * with a cookie. The embedding model is out for a quieter reason: changing it
 * makes every vector already stored incomparable, and search would simply stop
 * returning things with nothing to explain why.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { record } from "../lib/audit.js";
import { forgetSettings, serverSettings } from "../lib/settings.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const serverSettingsRouter = Router();

/** Enough to recognise a key you set, useless to anyone who did not. */
const hint = (value: string | null | undefined) =>
  value ? `…${value.slice(-4)}` : null;

serverSettingsRouter.get("/", requireUser, requireAdmin, async (_req, res) => {
  const [row] = await db
    .select()
    .from(schema.serverSettings)
    .where(eq(schema.serverSettings.id, 1))
    .limit(1);
  const live = await serverSettings();

  res.json({
    email: {
      // `configured` is the live answer — a key in the environment counts even
      // though nothing was ever saved here.
      configured: Boolean(live.resendApiKey),
      api_key_hint: hint(row?.resendApiKey),
      // True when the value in force came from `.env` rather than this screen,
      // so the console can say so instead of showing an empty field that lies.
      from_environment: Boolean(live.resendApiKey) && !row?.resendApiKey,
      from_address: live.emailFrom,
    },
    model: {
      extractor: live.extractor,
      local_llm_model: live.localLlmModel ?? null,
      anthropic_key_configured: Boolean(live.anthropicApiKey),
      anthropic_key_hint: hint(row?.anthropicApiKey),
    },
    updated_at: row?.updatedAt ?? null,
  });
});

const patchSchema = z.object({
  // `null` clears a setting and falls back to the environment; omitting a field
  // leaves it alone. Those are different things and the UI relies on both.
  resend_api_key: z.string().max(200).nullish(),
  email_from: z.string().max(320).nullish(),
  extractor: z.enum(["ollama", "anthropic"]).nullish(),
  local_llm_model: z.string().max(200).nullish(),
  anthropic_api_key: z.string().max(200).nullish(),
});

serverSettingsRouter.patch("/", requireUser, requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const body = patchSchema.parse(req.body);

  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: principal.userId };
  const map = {
    resend_api_key: "resendApiKey",
    email_from: "emailFrom",
    extractor: "extractor",
    local_llm_model: "localLlmModel",
    anthropic_api_key: "anthropicApiKey",
  } as const;
  for (const [from, to] of Object.entries(map)) {
    const value = body[from as keyof typeof body];
    if (value === undefined) continue;
    // An empty string is how a form sends "I cleared this".
    set[to] = value === null || value === "" ? null : value;
  }

  await db.update(schema.serverSettings).set(set).where(eq(schema.serverSettings.id, 1));
  forgetSettings();

  // The values are secret; which settings somebody touched is not, and is
  // exactly what a reader of the audit trail wants to know.
  const touched = Object.keys(map).filter(
    (k) => body[k as keyof typeof body] !== undefined,
  );
  await record(principal, "server.settings", touched.join(", ") || "nothing");

  res.json({ changed: touched });
});
