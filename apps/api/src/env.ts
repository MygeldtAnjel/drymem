/**
 * Configuration, from the environment, validated once at boot.
 *
 * A missing secret is a crash on startup rather than a 500 three days later.
 * The one exception is `RESEND_API_KEY`: without it the product still works —
 * invitation and reset links are returned to the caller for a human to forward,
 * which is the only thing that works on a laptop anyway.
 */

import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  BIND: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  /** Postgres, in libpq form — not SQLAlchemy's `postgresql+asyncpg://`. */
  DATABASE_URL: z.string().default("postgres://drymem:drymem_pass@localhost:5432/drymem"),

  /** Where the Python memory engine listens. Never exposed to the internet. */
  MEMORY_URL: z.string().default("http://127.0.0.1:8090"),

  /**
   * Shared with the Python service. This app mints a short-lived token that
   * says who the caller is; Python verifies it and trusts nothing else.
   */
  SERVICE_SECRET: z.string().min(16, "SERVICE_SECRET must be at least 16 characters"),

  /** Absolute base for links in emails. Must be reachable by the recipient. */
  PUBLIC_URL: z.string().default("http://127.0.0.1:8080"),

  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  SESSION_DAYS: z.coerce.number().default(30),
  INVITE_DAYS: z.coerce.number().default(7),
  RESET_MINUTES: z.coerce.number().default(60),

  /**
   * The landing site's origin, e.g. `https://drymem.dev`. Set only when the
   * marketing page is deployed somewhere other than this server, which is the
   * one thing in the product that talks to it cross-origin.
   */
  LANDING_ORIGIN: z.string().optional(),

  /** Where "somebody asked for access" goes. Defaults to the sender's address. */
  ACCESS_REQUESTS_TO: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("drymem <onboarding@resend.dev>"),

  /**
   * GitHub sign-in. Both absent means the feature is off and no button appears
   * — a self-hosted install on a laptop cannot register an OAuth app, and
   * password login has to keep working without one.
   */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  /** Where the built web app lives. Empty disables serving it. */
  WEB_DIR: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  console.error(`drymem-api cannot start:\n${problems.join("\n")}`);
  process.exit(1);
}

export const env = parsed.data;
export const emailEnabled = Boolean(env.RESEND_API_KEY);
