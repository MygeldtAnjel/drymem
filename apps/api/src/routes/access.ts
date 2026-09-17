/**
 * "Can I have an account?" — the one public write in the product.
 *
 * drymem is not self-serve. `POST /auth/signup` succeeds exactly once per
 * server, so a new team arrives by asking and being provisioned with
 * `drymem-admin org-create`. The landing page's form lands here.
 *
 * Public means hostile: this is the endpoint a stranger can reach, so it takes
 * a short, closed set of fields, caps every one of them, rate-limits by IP, and
 * answers the same way whatever happens. Nothing here reads back to the caller
 * — a queue that could be enumerated would be a list of who is evaluating us.
 */

import { Router } from "express";
import { desc, eq, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { record } from "../lib/audit.js";
import { sendAccessRequested } from "../lib/email.js";
import { limiter, notFound } from "../lib/errors.js";
import { param } from "../lib/params.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const accessRouter = Router();

/**
 * The only cross-origin door in the product.
 *
 * Everything else is served from one origin on purpose — no CORS, no second
 * deployment. The landing page is the exception: it is a static site that may
 * live on its own domain, and its form has to reach this endpoint. So exactly
 * one origin is allowed, exactly one method, and no credentials — a browser
 * that follows the rules cannot use this to read anything as somebody else.
 */
accessRouter.use((req, res, next) => {
  const allowed = env.LANDING_ORIGIN?.replace(/\/+$/, "");
  const origin = req.get("origin");
  if (allowed && origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") {
    res.status(allowed && origin === allowed ? 204 : 403).end();
    return;
  }
  next();
});

/** Generous for a person, useless for a script. */
const askLimit = limiter(5, 600_000);

const askSchema = z.object({
  email: z.email().max(320),
  name: z.string().max(200).optional().default(""),
  company: z.string().max(200).optional().default(""),
  about: z.string().max(2000).optional().default(""),
  team_size: z.string().max(40).optional().default(""),
});

accessRouter.post("/", async (req, res) => {
  askLimit(req.ip ?? "unknown");
  const body = askSchema.parse(req.body);
  const email = body.email.trim().toLowerCase();

  const [row] = await db
    .insert(schema.accessRequests)
    .values({
      email,
      name: body.name.trim() || null,
      company: body.company.trim() || null,
      about: body.about.trim() || null,
      teamSize: body.team_size.trim() || null,
      sourceIp: req.ip?.slice(0, 64) ?? null,
    })
    .returning();

  // Told, not polled: the queue is only useful if somebody knows it moved.
  // Deliberately after the insert — a request that exists with an unsent
  // notification is recoverable, one that was rolled back is not.
  //
  // It goes to whoever owns this server, which is the one address we can always
  // work out. With no mail configured the request is written to the log, the
  // way invitation and reset links are: a queue nobody is told about is a queue
  // nobody empties.
  const [owner] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.role, "owner"))
    .orderBy(schema.users.createdAt)
    .limit(1);
  void sendAccessRequested(owner?.email ?? "", {
    email,
    name: body.name.trim() || null,
    company: body.company.trim() || null,
    about: body.about.trim() || null,
    teamSize: body.team_size.trim() || null,
  }).then((sent) => {
    if (!sent.sent) {
      console.info(
        `access request from ${email}${body.company ? ` (${body.company})` : ""}: ${sent.reason}`,
      );
    }
  });

  res.status(201).json({
    id: row!.id,
    // Says what happens next and promises no timeline we have not chosen.
    detail: "Thanks — we have it. You will hear from us at this address.",
  });
});

// ---- the queue, for whoever runs the server ------------------------------------------

accessRouter.get("/", requireUser, requireAdmin, async (req, res) => {
  const status = String(req.query.status ?? "pending");
  const rows = await db
    .select()
    .from(schema.accessRequests)
    .where(status === "all" ? raw`true` : eq(schema.accessRequests.status, status))
    .orderBy(desc(schema.accessRequests.createdAt))
    .limit(200);

  res.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      company: r.company,
      about: r.about,
      team_size: r.teamSize,
      status: r.status,
      note: r.note,
      created_at: r.createdAt,
      decided_at: r.decidedAt,
    })),
  );
});

/**
 * Record the decision. It does not provision anything.
 *
 * Creating the organisation stays in `drymem-admin org-create`, where it has
 * always been: making an org is the one operation that hands somebody the keys
 * to a tenant, and it should take a shell and a deliberate command rather than
 * a button that could be clicked by accident.
 */
accessRouter.patch("/:id", requireUser, requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const body = z
    .object({
      status: z.enum(["pending", "approved", "declined"]),
      note: z.string().max(2000).optional().default(""),
    })
    .parse(req.body);

  const [row] = await db
    .update(schema.accessRequests)
    .set({
      status: body.status,
      note: body.note.trim() || null,
      decidedAt: body.status === "pending" ? null : new Date(),
      decidedBy: body.status === "pending" ? null : principal.userId,
    })
    .where(eq(schema.accessRequests.id, param(req, "id")))
    .returning();
  if (!row) throw notFound("No such request.");

  await record(principal, `access.${body.status}` as const, row.email);
  res.json({ id: row.id, email: row.email, status: row.status });
});
