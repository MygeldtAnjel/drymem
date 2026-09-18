/**
 * Settings an owner can change from the console, over the ones from the file.
 *
 * Everything here is optional in both directions. An install configured
 * entirely by `.env` never touches this and behaves exactly as before; one
 * configured from the console leaves `.env` alone. Neither is the "real" place.
 *
 * What is *not* here is as deliberate as what is. The database URLs stay in the
 * environment: a setting that decides where the data lives should need shell
 * access, and a wrong one typed into a browser takes away the browser you would
 * fix it with. The embedding model is absent for a quieter reason — changing it
 * makes every vector already stored incomparable, so search stops working with
 * nothing to show for it.
 *
 * Read through a short-lived cache. Sending an invitation should not also be a
 * database round-trip for configuration, and a change a person just made should
 * still take effect while they are watching.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { env } from "../env.js";

export interface ServerSettings {
  resendApiKey: string | undefined;
  emailFrom: string;
  extractor: string;
  localLlmModel: string | undefined;
  anthropicApiKey: string | undefined;
}

/** What is in the environment, which is what applies until somebody overrides it. */
function fromEnv(): ServerSettings {
  return {
    resendApiKey: env.RESEND_API_KEY || undefined,
    emailFrom: env.EMAIL_FROM,
    extractor: process.env.DRYMEM_EXTRACTOR || "ollama",
    localLlmModel: process.env.LOCAL_LLM_MODEL || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };
}

const TTL_MS = 10_000;
let cached: { at: number; value: ServerSettings } | null = null;

export function forgetSettings(): void {
  cached = null;
}

export async function serverSettings(): Promise<ServerSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const base = fromEnv();
  try {
    const [row] = await db
      .select()
      .from(schema.serverSettings)
      .where(eq(schema.serverSettings.id, 1))
      .limit(1);

    const value: ServerSettings = {
      resendApiKey: row?.resendApiKey || base.resendApiKey,
      emailFrom: row?.emailFrom || base.emailFrom,
      extractor: row?.extractor || base.extractor,
      localLlmModel: row?.localLlmModel || base.localLlmModel,
      anthropicApiKey: row?.anthropicApiKey || base.anthropicApiKey,
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    // A database that cannot be read is not a reason to stop sending email with
    // the configuration the process started with.
    return base;
  }
}
