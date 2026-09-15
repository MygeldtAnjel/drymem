/**
 * Projects, membership and roles — the half of the old Python suite that moved
 * here when the control plane took these routes over.
 *
 * The refusals are the point. A member who can rename a project or remove a
 * colleague is a permission model that exists only in the UI, and a project key
 * that can be edited is two halves of a team that never meet again.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;
let sql: ReturnType<typeof postgres>;

const PROJECT = "github.com/acme/payments";
const OWNER = { email: "owner@acme.test", password: "correct horse battery" };
const LEAD = { email: "lead@acme.test", password: "a lead's long password" };
const MEMBER = { email: "member@acme.test", password: "a member's long password" };

/** Sign someone in from an invitation and hand back their browser. */
async function join(who: { email: string; password: string }): Promise<Client> {
  const invited = await h.client.post("/auth/invites", { email: who.email, role: "member" });
  const token = invited.body.invite_url.split("/").pop();
  const client = new Client(h.base);
  await client.post(`/auth/invites/${token}/accept`, { password: who.password });
  return client;
}

/**
 * Make a project the way a save does.
 *
 * The engine creates projects on first write and it is not running here, so
 * these rows are inserted directly — the alternative is a test that proves the
 * engine works, which is the engine suite's job.
 */
async function makeProject(ownerEmail: string): Promise<void> {
  const [org] = await sql`SELECT id FROM orgs LIMIT 1`;
  const [owner] = await sql`SELECT id FROM users WHERE email = ${ownerEmail}`;
  const [project] = await sql`
    INSERT INTO projects (id, org_id, project_key, created_at)
    VALUES (gen_random_uuid(), ${org!.id}, ${PROJECT}, now())
    RETURNING id`;
  await sql`
    INSERT INTO project_members (id, project_id, user_id, role, created_at)
    VALUES (gen_random_uuid(), ${project!.id}, ${owner!.id}, 'lead', now())`;
}

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
  await makeProject(OWNER.email);
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await h?.stop();
  await scratch?.drop();
});

describe("projects", () => {
  it("lists the ones you are on, with your role", async () => {
    const { body } = await h.client.get("/v1/projects");
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].project_key).toBe(PROJECT);
    expect(body.projects[0].your_role).toBe("lead");
    expect(body.projects[0].capture_mode).toBe("automatic");
  });

  it("hides a project you are not on, as not-found rather than forbidden", async () => {
    // A 403 would confirm the project exists, which leaks one team's repo names.
    const stranger = await join(MEMBER);
    expect((await stranger.get("/v1/projects")).body.projects).toEqual([]);
    expect((await stranger.get(`/v1/projects/${PROJECT}/members`)).status).toBe(404);
  });

  it("renames the display name and never the key", async () => {
    const { status, body } = await h.client.patch(`/v1/projects/${PROJECT}`, {
      display_name: "Payments",
    });
    expect(status).toBe(200);
    expect(body.display_name).toBe("Payments");
    expect(body.project_key).toBe(PROJECT);
  });

  it("sets the capture mode", async () => {
    const { body } = await h.client.patch(`/v1/projects/${PROJECT}`, { capture_mode: "manual" });
    expect(body.capture_mode).toBe("manual");
    await h.client.patch(`/v1/projects/${PROJECT}`, { capture_mode: "automatic" });
  });

  it("refuses a key with no change in it", async () => {
    const { status } = await h.client.patch(`/v1/projects/${PROJECT}`, {});
    expect(status).toBe(400);
  });
});

describe("membership", () => {
  let member: Client;

  it("adds someone who is already in the organisation", async () => {
    member = await join(LEAD);
    const { status, body } = await h.client.post(`/v1/projects/${PROJECT}/members`, {
      email: LEAD.email,
    });
    expect(status).toBe(200);
    expect(body.members.map((m: { email: string }) => m.email).sort()).toEqual([
      LEAD.email,
      OWNER.email,
    ]);
    expect((await member.get("/v1/projects")).body.projects).toHaveLength(1);
  });

  it("adding twice is not an error", async () => {
    const { status, body } = await h.client.post(`/v1/projects/${PROJECT}/members`, {
      email: LEAD.email,
    });
    expect(status).toBe(200);
    expect(body.members).toHaveLength(2);
  });

  it("refuses somebody who has no account here", async () => {
    const { status } = await h.client.post(`/v1/projects/${PROJECT}/members`, {
      email: "nobody@elsewhere.test",
    });
    expect(status).toBe(404);
  });

  it("stops a plain member from managing the project", async () => {
    // Hidden buttons are not permissions: the refusal lives in the service.
    expect(
      (await member.patch(`/v1/projects/${PROJECT}`, { display_name: "Mine" })).status,
    ).toBe(403);
    expect(
      (await member.post(`/v1/projects/${PROJECT}/members`, { email: MEMBER.email })).status,
    ).toBe(403);
    expect(
      (await member.del(`/v1/projects/${PROJECT}/members/${OWNER.email}`)).status,
    ).toBe(403);
  });

  it("promotes a member to lead, who can then manage it", async () => {
    const { status, body } = await h.client.patch(
      `/v1/projects/${PROJECT}/members/${LEAD.email}`,
      { role: "lead" },
    );
    expect(status).toBe(200);
    expect(body.members.find((m: { email: string }) => m.email === LEAD.email).role).toBe("lead");

    const renamed = await member.patch(`/v1/projects/${PROJECT}`, { display_name: "Payments" });
    expect(renamed.status).toBe(200);
  });

  it("removes someone", async () => {
    const { status, body } = await h.client.del(
      `/v1/projects/${PROJECT}/members/${LEAD.email}`,
    );
    expect(status).toBe(200);
    expect(body.members.map((m: { email: string }) => m.email)).toEqual([OWNER.email]);
    expect((await member.get("/v1/projects")).body.projects).toEqual([]);
  });

  it("refuses to remove the last member", async () => {
    // A project with nobody on it cannot be opened by anyone, including
    // whoever would have to fix that.
    const { status, body } = await h.client.del(
      `/v1/projects/${PROJECT}/members/${OWNER.email}`,
    );
    expect(status).toBe(409);
    expect(body.detail).toMatch(/at least one member/);
  });
});

describe("people", () => {
  it("lists the organisation with counts and nothing else", async () => {
    const { body } = await h.client.get("/v1/users");
    const emails = body.users.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual([LEAD.email, MEMBER.email, OWNER.email].sort());
    for (const user of body.users) {
      expect(user).toHaveProperty("memory_count");
      // What somebody wrote is theirs until they share it.
      expect(user).not.toHaveProperty("memories");
    }
  });

  it("will not let an admin change or remove the owner", async () => {
    const { body } = await h.client.get("/v1/users");
    const owner = body.users.find((u: { email: string }) => u.email === OWNER.email);
    expect((await h.client.patch(`/v1/users/${owner.id}/role`, { role: "member" })).status).toBe(
      403,
    );
    expect((await h.client.del(`/v1/users/${owner.id}`)).status).toBe(403);
  });

  it("is not something a plain member can do", async () => {
    const stranger = new Client(h.base);
    await stranger.post("/auth/login", MEMBER);
    const { body } = await stranger.get("/v1/users");
    const target = body.users.find((u: { email: string }) => u.email === LEAD.email);
    expect((await stranger.patch(`/v1/users/${target.id}/role`, { role: "admin" })).status).toBe(
      403,
    );
  });
});

describe("the audit trail", () => {
  it("records what happened, for an admin only", async () => {
    // Asking for the whole trail on purpose: this is about what gets recorded,
    // not about what fits on the first page.
    const { body } = await h.client.get("/v1/audit?limit=200");
    const actions = body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain("org.create");
    expect(actions).toContain("member.invite");
    expect(actions).toContain("project.rename");
    expect(actions).toContain("member.remove");
    // Every event names who did it.
    expect(body.events.every((e: { actor: string | null }) => e.actor !== undefined)).toBe(true);

    const member = new Client(h.base);
    await member.post("/auth/login", MEMBER);
    expect((await member.get("/v1/audit")).status).toBe(403);
  });
});

describe("the memory engine", () => {
  it("reports an outage as one, rather than as a bad request", async () => {
    // MEMORY_URL points at a closed port in these tests.
    const { status, body } = await h.client.get(
      `/v1/memories/context?project_key=${PROJECT}`,
    );
    expect(status).toBe(502);
    expect(body.detail).toMatch(/not responding/i);
  });

  it("does not forward an unauthenticated caller at all", async () => {
    const anon = new Client(h.base);
    const { status } = await anon.get(`/v1/memories/context?project_key=${PROJECT}`);
    expect(status).toBe(401);
  });
});
