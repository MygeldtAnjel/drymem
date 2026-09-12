/**
 * The control plane's tables.
 *
 * Primary keys are generated here, with `$defaultFn`, not by the database.
 * SQLAlchemy makes them in Python and Alembic therefore creates these columns
 * with no `DEFAULT`, so Drizzle's `defaultRandom()` emitted `DEFAULT` and
 * Postgres inserted NULL. That is the exact class of bug two ORMs on one schema
 * produce, and the reason for the rule below.
 *
 * One Postgres, **one** schema authority: Alembic, in `apps/server/migrations`.
 * Drizzle appears here purely as a typed query builder — `drizzle-kit` is never
 * run, and nothing in this app creates or alters a table.
 *
 * Two migration tools against one database was the first design and it was
 * wrong: disjoint table sets sound clean until someone adds a foreign key
 * across the line, and then two histories have to be replayed in an order
 * neither of them records. One authority costs a round-trip through a Python
 * file when this service needs a column, and buys a single ordered history.
 * PLAN.md D41.
 */

import { randomUUID } from "node:crypto";

import { relations } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---- organisation and people -------------------------------------------------

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 200 }),
    passwordHash: varchar("password_hash", { length: 300 }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_users_org_email").on(t.orgId, t.email)],
);

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  label: varchar("label", { length: 200 }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webSessions = pgTable("web_sessions", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userAgent: varchar("user_agent", { length: 300 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  projectId: uuid("project_id"),
  invitedBy: uuid("invited_by"),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deviceCodes = pgTable("device_codes", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  deviceHash: varchar("device_hash", { length: 64 }).notNull().unique(),
  userCode: varchar("user_code", { length: 12 }).notNull().unique(),
  label: varchar("label", { length: 200 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  issuedToken: varchar("issued_token", { length: 200 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Password resets.
 *
 * Single use, short lived, and hashed like every other credential: a database
 * dump must not let anyone take over an account by replaying a link.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    requestedIp: varchar("requested_ip", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_password_resets_user").on(t.userId)],
);

// ---- projects -----------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    projectKey: varchar("project_key", { length: 500 }).notNull(),
    displayName: varchar("display_name", { length: 200 }),
    captureMode: varchar("capture_mode", { length: 20 }).notNull().default("automatic"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_projects_org_key").on(t.orgId, t.projectKey)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_member_project_user").on(t.projectId, t.userId)],
);

// ---- memories (the engine writes these; this service only reads them) ---------------

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id").notNull(),
  authorId: uuid("author_id").notNull(),
  episodeUuid: varchar("episode_uuid", { length: 64 }).notNull(),
  topicKey: varchar("topic_key", { length: 300 }),
  title: varchar("title", { length: 500 }).notNull(),
  tool: varchar("tool", { length: 50 }).notNull(),
  scope: varchar("scope", { length: 20 }).notNull(),
  memoryType: varchar("memory_type", { length: 30 }).notNull(),
  sessionId: varchar("session_id", { length: 64 }),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  teamEpisodeUuid: varchar("team_episode_uuid", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const memoryFeedback = pgTable("memory_feedback", {
  id: uuid("id").primaryKey(),
  memoryId: uuid("memory_id").notNull(),
  userId: uuid("user_id").notNull(),
  rating: integer("rating").notNull(),
  query: varchar("query", { length: 500 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// ---- skills ----------------------------------------------------------------------

/**
 * The catalogue. One row per skill the organisation has, whatever its source.
 *
 * Content lives on the *version*, never here: a second copy on the skill is how
 * the two drift, and what a project pins is a version rather than a name.
 */
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Set only for a project-scoped skill; null for one the whole org can use. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    topic: varchar("topic", { length: 300 }).notNull().default(""),
    description: text("description"),
    /** org | project */
    scope: varchar("scope", { length: 20 }).notNull().default("org"),
    /** base | distilled | imported | authored */
    source: varchar("source", { length: 20 }).notNull().default("distilled"),
    /** draft | pending | published | deprecated */
    state: varchar("state", { length: 20 }).notNull().default("published"),
    /** Where an imported skill came from, verbatim. */
    origin: varchar("origin", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_skills_org_name").on(t.orgId, t.name)],
);

/**
 * An immutable version of a skill.
 *
 * Content-addressed, so "is this the same skill the lockfile pinned?" is a
 * string comparison rather than a diff. Nothing ever edits one; publishing
 * again adds the next.
 */
export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    files: json("files").$type<Record<string, string>>().notNull().default({}),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    model: varchar("model", { length: 100 }),
    memoryCount: integer("memory_count").notNull().default(0),
    /** What the scanner found. An empty list is a clean bill. */
    findings: json("findings").$type<Finding[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    note: varchar("note", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_skill_version").on(t.skillId, t.version)],
);

export interface Finding {
  rule: string;
  severity: "reject" | "review";
  detail: string;
  line?: number;
}

/** What a project has turned on, pinned to one version. */
export const projectSkills = pgTable(
  "project_skills",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => skillVersions.id),
    enabledBy: uuid("enabled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_project_skill").on(t.projectId, t.skillId)],
);

/**
 * Which skill an agent actually read.
 *
 * The difference between "we have forty skills" and "these six are the ones
 * anyone uses" — and what shows a lead that the skill they enabled never fired.
 * It records *that* a skill was read, never what the agent then did with it;
 * the latter would be a transcript (PLAN.md D35).
 */
export const skillUses = pgTable(
  "skill_uses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id").notNull(),
    projectId: uuid("project_id").notNull(),
    skillId: uuid("skill_id").notNull(),
    userId: uuid("user_id"),
    agent: varchar("agent", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_skill_uses_skill").on(t.skillId, t.createdAt)],
);

// ---- billing -------------------------------------------------------------------------

/**
 * One row per organisation. Absent means the free tier, which is why nothing
 * reads this to decide whether the product works — it decides what is *metered*.
 * Stripe is not wired yet; the row exists so usage has somewhere to go.
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" })
    .unique(),
  plan: varchar("plan", { length: 40 }).notNull().default("free"),
  status: varchar("status", { length: 40 }).notNull().default("active"),
  seats: integer("seats").notNull().default(0),
  stripeCustomerId: varchar("stripe_customer_id", { length: 120 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 120 }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- audit -----------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id").notNull(),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 100 }).notNull(),
    target: text("target"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_audit_org_created").on(t.orgId, t.createdAt)],
);

// ---- relations -----------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  org: one(orgs, { fields: [users.orgId], references: [orgs.id] }),
  tokens: many(apiTokens),
  memberships: many(projectMembers),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, { fields: [projects.orgId], references: [orgs.id] }),
  members: many(projectMembers),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Invite = typeof invites.$inferSelect;
