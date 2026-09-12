/**
 * The audit trail.
 *
 * Step D's "done when" is one sentence — an admin can answer *"who enabled this
 * skill, and has anyone pasted a credential this month?"* from one screen — so
 * these tests are that sentence, plus the two things that would quietly ruin
 * it: a member being able to read it, and the newest events falling off the
 * first page.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;
let sql: ReturnType<typeof postgres>;

const PROJECT = "github.com/acme/payment-ui";
const OWNER = { email: "owner@acme.test", password: "correct horse battery" };
const DEV = { email: "dev@acme.test", password: "a developer's password" };

const SKILL = `---
name: retry-backoff
description: When retrying a payment call.
---

Cap the backoff at 30 seconds.
`;

beforeAll(async () => {
  scratch = await scratchDatabase();
  h = await startServer(scratch.url);
  sql = postgres(scratch.url, { max: 2 });
  await h.client.post("/auth/signup", {
    org_name: "Acme",
    email: OWNER.email,
    password: OWNER.password,
    name: "Owner",
  });

  const [org] = await sql`SELECT id FROM orgs LIMIT 1`;
  const [owner] = await sql`SELECT id FROM users WHERE email = ${OWNER.email}`;
  const [project] = await sql`
    INSERT INTO projects (id, org_id, project_key, created_at)
    VALUES (gen_random_uuid(), ${org!.id}, ${PROJECT}, now()) RETURNING id`;
  await sql`
    INSERT INTO project_members (id, project_id, user_id, role, created_at)
    VALUES (gen_random_uuid(), ${project!.id}, ${owner!.id}, 'lead', now())`;
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await h?.stop();
  await scratch?.drop();
});

describe("who enabled this skill", () => {
  it("records the action, the target and the person", async () => {
    await h.client.post("/v1/skills", { name: "retry-backoff", content: SKILL });
    await h.client.post("/v1/skills/retry-backoff/enable", { project_key: PROJECT });

    const { status, body } = await h.client.get("/v1/audit?group=skills");
    expect(status).toBe(200);

    const enabled = body.events.find((e: { action: string }) => e.action === "skill.enable");
    expect(enabled.target).toContain("retry-backoff");
    expect(enabled.target).toContain(PROJECT);
    expect(enabled.actor).toBe(OWNER.email);
    expect(enabled.created_at).toBeTruthy();
  });

  it("puts the newest event first", async () => {
    // The first version of this took the *oldest* rows and reversed them, so
    // anything recent was invisible the moment the log grew past a page.
    const { body } = await h.client.get("/v1/audit?limit=3");
    const ids = body.events.map((e: { id: number }) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    const all = await h.client.get("/v1/audit?limit=200");
    expect(ids[0]).toBe(Math.max(...all.body.events.map((e: { id: number }) => e.id)));
  });

  it("pages backwards without an offset", async () => {
    const first = await h.client.get("/v1/audit?limit=2");
    expect(first.body.next_before).toBeTruthy();

    const second = await h.client.get(`/v1/audit?limit=2&before=${first.body.next_before}`);
    const firstIds = first.body.events.map((e: { id: number }) => e.id);
    const secondIds = second.body.events.map((e: { id: number }) => e.id);
    expect(secondIds.every((id: number) => !firstIds.includes(id))).toBe(true);
    expect(Math.max(...secondIds)).toBeLessThan(Math.min(...firstIds));
  });

  it("says when there is no next page", async () => {
    const { body } = await h.client.get("/v1/audit?limit=200");
    expect(body.next_before).toBeNull();
  });
});

describe("filtering", () => {
  it("narrows to one action", async () => {
    const { body } = await h.client.get("/v1/audit?action=skill.publish");
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e: { action: string }) => e.action === "skill.publish")).toBe(true);
  });

  it("covers both services' spellings of the same concept", async () => {
    // The engine writes `project.set_role`; this service writes `member.role`.
    // A "People" filter that showed only one of them would be quietly wrong.
    const { GROUPS } = await import("../src/routes/audit.js");
    expect(GROUPS.people).toContain("member.role");
    expect(GROUPS.people).toContain("project.set_role");
    expect(GROUPS.people).toContain("project.add_member");
  });

  it("narrows to one person", async () => {
    const { body } = await h.client.get(`/v1/audit?actor=${encodeURIComponent(OWNER.email)}`);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e: { actor: string }) => e.actor === OWNER.email)).toBe(true);

    const nobody = await h.client.get("/v1/audit?actor=nobody@acme.test");
    expect(nobody.body.events).toEqual([]);
  });

  it("narrows to a date, and ignores one it cannot read", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const { body } = await h.client.get(`/v1/audit?since=${tomorrow}`);
    expect(body.events).toEqual([]);

    // A bad date must not empty the screen; it is a filter, not a gate.
    const junk = await h.client.get("/v1/audit?since=not-a-date");
    expect(junk.body.events.length).toBeGreaterThan(0);
  });
});

describe("has anyone pasted a credential this month", () => {
  it("is one number, not a table to add up", async () => {
    // The engine writes these rows; here they stand in for it, because the
    // question is whether the reader surfaces them.
    const [org] = await sql`SELECT id FROM orgs LIMIT 1`;
    const [owner] = await sql`SELECT id FROM users WHERE email = ${OWNER.email}`;
    await sql`
      INSERT INTO audit_log (org_id, actor_id, action, target, created_at) VALUES
      (${org!.id}, ${owner!.id}, 'memory.rejected', ${`${PROJECT}:private-key`}, now()),
      (${org!.id}, ${owner!.id}, 'memory.scrubbed', ${`${PROJECT}:aws_key`}, now())`;

    const { status, body } = await h.client.get("/v1/audit/summary?days=30");
    expect(status).toBe(200);
    expect(body.credentials).toEqual({ rejected: 1, redacted: 1 });
    expect(body.total).toBeGreaterThan(2);
    expect(body.actions.find((a: { action: string }) => a.action === "skill.enable")).toBeDefined();
  });

  it("groups them under security, next to the approvals", async () => {
    const { body } = await h.client.get("/v1/audit?group=security");
    const actions = body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("memory.rejected");
    expect(actions).toContain("memory.scrubbed");
    expect(actions).not.toContain("skill.enable");
  });

  it("never carries the value that was redacted", async () => {
    const { body } = await h.client.get("/v1/audit?group=security");
    // The target names the rule and the project. If a secret could reach this
    // table, the audit trail would be the second copy of it.
    for (const event of body.events) {
      expect(event.target ?? "").not.toMatch(/AKIA|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20}/);
    }
  });
});

describe("who may read it", () => {
  it("is refused to a member", async () => {
    const invited = await h.client.post("/auth/invites", { email: DEV.email, role: "member" });
    const token = invited.body.invite_url.split("/").pop();
    const dev = new Client(h.base);
    await dev.post(`/auth/invites/${token}/accept`, { password: DEV.password });

    expect((await dev.get("/v1/audit")).status).toBe(403);
    expect((await dev.get("/v1/audit/summary")).status).toBe(403);
  });

  it("is refused to a stranger with no session at all", async () => {
    const anon = new Client(h.base);
    expect((await anon.get("/v1/audit")).status).toBe(401);
  });
});
