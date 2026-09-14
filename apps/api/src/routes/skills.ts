/**
 * The skills catalogue.
 *
 * The shape of the whole feature, in one paragraph: an organisation has a
 * **catalogue** of skills; each skill has immutable, content-addressed
 * **versions**; a project **enables** one version of a skill; the repo carries
 * a generated **lockfile** of what it enabled; and `drymem skills pull` installs
 * exactly that, for whichever agents are on the machine. A tech lead enables it
 * once and everyone else runs `git pull`.
 *
 * None of this needs a model, which is why it lives here. `/v1/skills/discover`
 * and `/v1/skills/distill` do, and fall through to the engine — nothing in this
 * router answers them.
 */

import { Router } from "express";
import { and, desc, eq, inArray, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import { record } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { param } from "../lib/params.js";
import { isAdmin, type Principal } from "../lib/principal.js";
import { publishVersion, slug } from "../lib/publish.js";
import { seedCatalogue } from "../lib/seed.js";
import { principalOf, requireAdmin, requireUser } from "../middleware/auth.js";

export const skillRouter = Router();
skillRouter.use(requireUser);

async function projectFor(principal: Principal, key: string) {
  const [row] = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projects.projectKey, key),
        eq(schema.projects.orgId, principal.orgId),
        eq(schema.projectMembers.userId, principal.userId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("No such project.");
  return row;
}

async function asLead(principal: Principal, key: string) {
  const row = await projectFor(principal, key);
  if (row.role !== "lead" && !isAdmin(principal)) {
    throw forbidden("Only a project lead or an organisation admin can change a project's skills.");
  }
  return row.project;
}

/** The current version of a skill: the highest number, always. */
async function latest(skillId: string) {
  const [row] = await db
    .select()
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skillId))
    .orderBy(desc(schema.skillVersions.version))
    .limit(1);
  return row;
}

// ---- reading -------------------------------------------------------------------

/** What this project has enabled, with the version it is pinned to. */
skillRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);

  const [found] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projects.projectKey, query.project_key),
        eq(schema.projects.orgId, principal.orgId),
        eq(schema.projectMembers.userId, principal.userId),
      ),
    )
    .limit(1);
  if (!found) {
    res.json({ project_key: query.project_key, skills: [] });
    return;
  }

  const rows = await db
    .select({
      skill: schema.skills,
      version: schema.skillVersions,
      author: schema.users.email,
      uses: raw<number>`(
        select count(*) from skill_uses u
        where u.skill_id = ${schema.skills.id} and u.project_id = ${found.id}
      )`,
      newest: raw<number>`(
        select max(version) from skill_versions v where v.skill_id = ${schema.skills.id}
      )`,
    })
    .from(schema.projectSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.projectSkills.skillId))
    .innerJoin(schema.skillVersions, eq(schema.skillVersions.id, schema.projectSkills.versionId))
    .leftJoin(schema.users, eq(schema.users.id, schema.skills.authorId))
    .where(eq(schema.projectSkills.projectId, found.id))
    .orderBy(schema.skills.name);

  res.json({
    project_key: query.project_key,
    skills: rows.map((r) => ({
      id: r.skill.id,
      name: r.skill.name,
      topic: r.skill.topic,
      description: r.skill.description,
      content: r.version.content,
      files: r.version.files,
      author: r.author,
      model: r.version.model,
      memory_count: r.version.memoryCount,
      scope: r.skill.scope,
      source: r.skill.source,
      state: r.skill.state,
      origin: r.skill.origin,
      version: r.version.version,
      sha256: r.version.sha256,
      latest_version: Number(r.newest),
      // Pinned behind the newest: the UI offers the update rather than taking it.
      outdated: Number(r.newest) > r.version.version,
      findings: r.version.findings,
      uses: Number(r.uses),
      updated_at: r.version.createdAt,
    })),
  });
});

/** Everything the organisation has, enabled here or not. */
skillRouter.get("/catalogue", async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500).optional() }).parse(req.query);

  let enabled = new Set<string>();
  if (query.project_key) {
    const { project } = await projectFor(principal, query.project_key);
    const rows = await db
      .select({ skillId: schema.projectSkills.skillId })
      .from(schema.projectSkills)
      .where(eq(schema.projectSkills.projectId, project.id));
    enabled = new Set(rows.map((r) => r.skillId));
  }

  const rows = await db
    .select({
      skill: schema.skills,
      author: schema.users.email,
      newest: raw<number>`(
        select max(version) from skill_versions v where v.skill_id = ${schema.skills.id}
      )`,
      uses: raw<number>`(select count(*) from skill_uses u where u.skill_id = ${schema.skills.id})`,
    })
    .from(schema.skills)
    .leftJoin(schema.users, eq(schema.users.id, schema.skills.authorId))
    .where(eq(schema.skills.orgId, principal.orgId))
    .orderBy(schema.skills.name);

  res.json({
    skills: rows.map((r) => ({
      id: r.skill.id,
      name: r.skill.name,
      topic: r.skill.topic,
      description: r.skill.description,
      author: r.author,
      scope: r.skill.scope,
      source: r.skill.source,
      state: r.skill.state,
      origin: r.skill.origin,
      latest_version: Number(r.newest ?? 0),
      uses: Number(r.uses),
      enabled_here: enabled.has(r.skill.id),
      updated_at: r.skill.updatedAt,
    })),
  });
});

/**
 * The lockfile a repo commits.
 *
 * Generated, not authored. It exists so the enabled set is visible in git
 * history and installable when the server is unreachable, and the hashes are
 * what let `pull` know it already has the right bytes.
 */
skillRouter.get("/lock", async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);
  const { project } = await projectFor(principal, query.project_key);

  const rows = await db
    .select({ skill: schema.skills, version: schema.skillVersions })
    .from(schema.projectSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.projectSkills.skillId))
    .innerJoin(schema.skillVersions, eq(schema.skillVersions.id, schema.projectSkills.versionId))
    .where(eq(schema.projectSkills.projectId, project.id))
    .orderBy(schema.skills.name);

  res.json({
    lockfileVersion: 1,
    project: project.projectKey,
    generatedAt: new Date().toISOString(),
    skills: rows.map((r) => ({
      name: r.skill.name,
      version: r.version.version,
      sha256: r.version.sha256,
      source: r.skill.source,
      ...(r.skill.origin ? { origin: r.skill.origin } : {}),
    })),
  });
});

/**
 * Who is actually reading the skills this project installed.
 *
 * Deliberately aggregate. `skill_uses` has a `user_id`, but answering "which
 * skills did Ana's agent read on Tuesday" is surveillance, and drymem is
 * already the tool that says it stores summaries and not transcripts. The
 * question this answers is the compliance one — is anything installed on every
 * laptop here that nothing has ever loaded — so it counts distinct readers
 * rather than naming them.
 */
skillRouter.get("/usage", async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);
  const { project } = await projectFor(principal, query.project_key);

  const rows = await db
    .select({
      name: schema.skills.name,
      source: schema.skills.source,
      uses: raw<number>`count(${schema.skillUses.id})::int`,
      readers: raw<number>`count(distinct ${schema.skillUses.userId})::int`,
      agents: raw<string[]>`coalesce(array_agg(distinct ${schema.skillUses.agent}) filter (where ${schema.skillUses.agent} is not null), '{}')`,
      last_used_at: raw<string | null>`max(${schema.skillUses.createdAt})`,
    })
    .from(schema.projectSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.projectSkills.skillId))
    .leftJoin(
      schema.skillUses,
      and(
        eq(schema.skillUses.skillId, schema.skills.id),
        eq(schema.skillUses.projectId, project.id),
      ),
    )
    .where(eq(schema.projectSkills.projectId, project.id))
    .groupBy(schema.skills.name, schema.skills.source)
    .orderBy(schema.skills.name);

  res.json({ project: project.projectKey, skills: rows });
});

skillRouter.get("/:name/versions", async (req, res) => {
  const principal = principalOf(req);
  const [skill] = await db
    .select()
    .from(schema.skills)
    .where(
      and(eq(schema.skills.orgId, principal.orgId), eq(schema.skills.name, param(req, "name"))),
    )
    .limit(1);
  if (!skill) throw notFound("No such skill.");

  const rows = await db
    .select({ version: schema.skillVersions, author: schema.users.email })
    .from(schema.skillVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.skillVersions.createdBy))
    .where(eq(schema.skillVersions.skillId, skill.id))
    .orderBy(desc(schema.skillVersions.version));

  res.json({
    name: skill.name,
    versions: rows.map((r) => ({
      version: r.version.version,
      sha256: r.version.sha256,
      content: r.version.content,
      model: r.version.model,
      memory_count: r.version.memoryCount,
      findings: r.version.findings,
      note: r.version.note,
      author: r.author,
      created_at: r.version.createdAt,
    })),
  });
});

// ---- writing -------------------------------------------------------------------

const publishSchema = z.object({
  name: z.string().min(1).max(200),
  topic: z.string().max(300).optional().default(""),
  description: z.string().max(2000).optional().default(""),
  content: z.string().min(1),
  files: z.record(z.string(), z.string()).optional().default({}),
  model: z.string().max(100).nullish(),
  memory_count: z.number().int().min(0).optional().default(0),
  source: z.enum(["base", "distilled", "imported", "authored"]).optional().default("authored"),
  origin: z.string().max(300).nullish(),
  note: z.string().max(300).optional().default(""),
  /** Enable it for this project as well, in the same call. */
  project_key: z.string().max(500).nullish(),
});

/**
 * Publish a skill, or add a version to one.
 *
 * Everything goes through the scanner. A credential rejects outright; anything
 * else stores the version as `pending` and tells the caller what a human needs
 * to look at.
 */
skillRouter.post("/", async (req, res) => {
  const principal = principalOf(req);
  const body = publishSchema.parse(req.body);
  if (!slug(body.name)) throw badRequest("That name has no usable characters in it.");

  if (body.source === "imported" && !isAdmin(principal)) {
    // An imported skill runs on every laptop on the project; that is an
    // organisation decision, not a project one (PLAN.md §8).
    throw forbidden("Only an organisation admin can import a skill from outside.");
  }

  const result = await publishVersion(principal, body);
  if (result.outcome === "rejected") {
    res.status(422).json({
      detail: "That skill contains a credential. Rotate it and publish again.",
      findings: result.findings,
    });
    return;
  }
  if (result.outcome === "unchanged") {
    res.json({ name: result.name, version: result.version, unchanged: true, findings: result.findings });
    return;
  }

  if (body.project_key && result.state === "published") {
    const project = await asLead(principal, body.project_key);
    await db
      .insert(schema.projectSkills)
      .values({
        projectId: project.id,
        skillId: result.skillId,
        versionId: result.versionId,
        enabledBy: principal.userId,
      })
      .onConflictDoUpdate({
        target: [schema.projectSkills.projectId, schema.projectSkills.skillId],
        set: { versionId: result.versionId, enabledBy: principal.userId },
      });
    await record(principal, "skill.enable", `${result.name} in ${body.project_key}`);
  }

  res.json({
    id: result.skillId,
    name: result.name,
    version: result.version,
    sha256: result.sha256,
    state: result.state,
    findings: result.findings,
    // Say it plainly rather than leaving a "published" that is not installed.
    detail:
      result.state === "pending"
        ? "Stored for review. An organisation admin has to approve it before a project can use it."
        : undefined,
  });
});

/**
 * Put the bundled base skills in this organisation's catalogue.
 *
 * Signup does this already. This is for the organisations that existed before
 * it did — every self-hosted install that upgrades has an empty catalogue and
 * no way to fill it. Idempotent: identical bytes are the same version, so
 * running it twice adds nothing.
 */
skillRouter.post("/seed", requireAdmin, async (req, res) => {
  const principal = principalOf(req);
  const seeded = await seedCatalogue(principal);
  await record(principal, "skill.publish", `base set: ${seeded.published.length} published`);
  res.json({
    published: seeded.published,
    pending: seeded.pending,
    skipped: seeded.skipped,
    detail:
      seeded.published.length === 0 && seeded.pending.length === 0
        ? "Nothing to add — the base skills are already here."
        : `${seeded.published.length} published, ${seeded.pending.length} held for review.`,
  });
});

/** Turn a catalogue skill on for a project, pinned to a version. */
skillRouter.post("/:name/enable", async (req, res) => {
  const principal = principalOf(req);
  const body = z
    .object({ project_key: z.string().max(500), version: z.number().int().min(1).optional() })
    .parse(req.body);
  const project = await asLead(principal, body.project_key);

  const [skill] = await db
    .select()
    .from(schema.skills)
    .where(
      and(eq(schema.skills.orgId, principal.orgId), eq(schema.skills.name, param(req, "name"))),
    )
    .limit(1);
  if (!skill) throw notFound("No such skill in this organisation.");
  if (skill.state === "pending") {
    throw conflict("That skill is waiting for an admin to review it.");
  }

  const version = body.version
    ? (
        await db
          .select()
          .from(schema.skillVersions)
          .where(
            and(
              eq(schema.skillVersions.skillId, skill.id),
              eq(schema.skillVersions.version, body.version),
            ),
          )
          .limit(1)
      )[0]
    : await latest(skill.id);
  if (!version) throw notFound("No such version.");

  await db
    .insert(schema.projectSkills)
    .values({
      projectId: project.id,
      skillId: skill.id,
      versionId: version.id,
      enabledBy: principal.userId,
    })
    .onConflictDoUpdate({
      target: [schema.projectSkills.projectId, schema.projectSkills.skillId],
      set: { versionId: version.id, enabledBy: principal.userId },
    });

  await record(
    principal,
    "skill.enable",
    `${skill.name}@${version.version} in ${body.project_key}`,
  );
  res.json({ name: skill.name, version: version.version, sha256: version.sha256 });
});

skillRouter.delete("/:name/enable", async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);
  const project = await asLead(principal, query.project_key);

  const [skill] = await db
    .select()
    .from(schema.skills)
    .where(
      and(eq(schema.skills.orgId, principal.orgId), eq(schema.skills.name, param(req, "name"))),
    )
    .limit(1);
  if (!skill) throw notFound("No such skill.");

  const [removed] = await db
    .delete(schema.projectSkills)
    .where(
      and(
        eq(schema.projectSkills.projectId, project.id),
        eq(schema.projectSkills.skillId, skill.id),
      ),
    )
    .returning();
  if (!removed) throw notFound("That skill is not enabled here.");

  await record(principal, "skill.disable", `${skill.name} in ${query.project_key}`);
  res.json({ name: skill.name, enabled: false });
});

/**
 * Deprecate rather than delete.
 *
 * Projects pinned to it keep working and are warned; deleting would break a
 * `pull` on a machine that has done nothing wrong.
 */
skillRouter.post("/:name/deprecate", async (req, res) => {
  const principal = principalOf(req);
  if (!isAdmin(principal)) throw forbidden("Only an organisation admin can deprecate a skill.");

  const [skill] = await db
    .update(schema.skills)
    .set({ state: "deprecated", updatedAt: new Date() })
    .where(
      and(eq(schema.skills.orgId, principal.orgId), eq(schema.skills.name, param(req, "name"))),
    )
    .returning();
  if (!skill) throw notFound("No such skill.");

  const [{ n } = { n: 0 }] = await db
    .select({ n: raw<number>`count(*)` })
    .from(schema.projectSkills)
    .where(eq(schema.projectSkills.skillId, skill.id));

  await record(principal, "skill.deprecate", skill.name);
  res.json({ name: skill.name, state: skill.state, still_enabled_in: Number(n) });
});

/** Approve a version the scanner held. */
skillRouter.post("/:name/approve", async (req, res) => {
  const principal = principalOf(req);
  if (!isAdmin(principal)) throw forbidden("Only an organisation admin can approve a skill.");

  const [skill] = await db
    .update(schema.skills)
    .set({ state: "published", updatedAt: new Date() })
    .where(
      and(
        eq(schema.skills.orgId, principal.orgId),
        eq(schema.skills.name, param(req, "name")),
        eq(schema.skills.state, "pending"),
      ),
    )
    .returning();
  if (!skill) throw notFound("No such skill is waiting for review.");

  await record(principal, "skill.approve", skill.name);
  res.json({ name: skill.name, state: skill.state });
});

/**
 * Which skills an agent actually read.
 *
 * Reported by the hooks after a `pull`. It records that a skill was read, by
 * which agent, in which project — never what the agent did with it.
 */
skillRouter.post("/used", async (req, res) => {
  const principal = principalOf(req);
  const body = z
    .object({
      project_key: z.string().max(500),
      agent: z.string().max(40),
      names: z.array(z.string().max(200)).max(200),
    })
    .parse(req.body);

  const { project } = await projectFor(principal, body.project_key);
  if (body.names.length === 0) {
    res.status(204).end();
    return;
  }

  const rows = await db
    .select({ id: schema.skills.id })
    .from(schema.skills)
    .where(
      and(eq(schema.skills.orgId, principal.orgId), inArray(schema.skills.name, body.names)),
    );
  if (rows.length > 0) {
    await db.insert(schema.skillUses).values(
      rows.map((r) => ({
        orgId: principal.orgId,
        projectId: project.id,
        skillId: r.id,
        userId: principal.userId,
        agent: body.agent,
      })),
    );
  }
  res.status(204).end();
});
