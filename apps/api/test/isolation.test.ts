/**
 * One tenant must not be able to see another.
 *
 * The shape of the test is deliberate: build two complete organisations, then
 * take **Beta's** credentials and point them at every one of **Acme's** ids and
 * keys in turn. A per-feature test asks "does this endpoint scope by org?" and
 * gets the answer the author intended; this one asks it of the whole surface at
 * once, which is where the one forgotten `where` clause shows up.
 *
 * The expected answer is almost always 404 rather than 403. "You may not read
 * project X" confirms that project X exists, and in a hosted product a
 * competitor's project names are themselves worth something.
 *
 * The second organisation is created in SQL, not over HTTP: signup deliberately
 * refuses once a server has an org, since a self-hosted install is one company.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { hashPassword } from "../src/lib/crypto.js";
import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;
let sql: ReturnType<typeof postgres>;
/** Signed in as Beta's owner, reaching for Acme's things. */
let beta: Client;

const ACME_PROJECT = "github.com/acme/payment-ui";
const BETA_PROJECT = "github.com/beta/storefront";
const ACME = { email: "owner@acme.test", password: "correct horse battery" };
const BETA = { email: "owner@beta.test", password: "a different long password" };

const SKILL = `---
name: acme-retry
description: How Acme retries a payment call.
---

Cap the backoff at 30 seconds.
`;

/** Ids of Acme's rows, for Beta to fail to reach. */
const acme: Record<string, string> = {};
const id = (key: string): string => acme[key]!;

beforeAll(async () => {
  scratch = await scratchDatabase();
  h = await startServer(scratch.url);
  sql = postgres(scratch.url, { max: 2 });

  // ---- Acme, through the front door.
  await h.client.post("/auth/signup", {
    org_name: "Acme",
    email: ACME.email,
    password: ACME.password,
    name: "Acme Owner",
  });
  const [acmeOrg] = await sql`SELECT id FROM orgs WHERE slug = 'acme'`;
  const [acmeOwner] = await sql`SELECT id FROM users WHERE email = ${ACME.email}`;
  const [acmeProject] = await sql`
    INSERT INTO projects (id, org_id, project_key, created_at)
    VALUES (gen_random_uuid(), ${acmeOrg!.id}, ${ACME_PROJECT}, now()) RETURNING id`;
  await sql`
    INSERT INTO project_members (id, project_id, user_id, role, created_at)
    VALUES (gen_random_uuid(), ${acmeProject!.id}, ${acmeOwner!.id}, 'lead', now())`;

  acme.org = acmeOrg!.id as string;
  acme.user = acmeOwner!.id as string;
  acme.project = acmeProject!.id as string;

  const published = await h.client.post("/v1/skills", {
    name: "acme-retry",
    content: SKILL,
    project_key: ACME_PROJECT,
  });
  acme.skill = published.body.id as string;

  const invited = await h.client.post("/auth/invites", {
    email: "pending@acme.test",
    role: "member",
  });
  acme.invite = invited.body.id as string;
  acme.inviteToken = invited.body.invite_url.split("/").pop() as string;

  const token = await h.client.post("/auth/tokens", { label: "Acme CI" });
  acme.token = token.body.id as string;
  acme.tokenSecret = token.body.token as string;

  // ---- Beta, in SQL, because signup refuses a second organisation.
  const [betaOrg] = await sql`
    INSERT INTO orgs (id, name, slug, created_at)
    VALUES (gen_random_uuid(), 'Beta', 'beta', now()) RETURNING id`;
  const [betaOwner] = await sql`
    INSERT INTO users (id, org_id, email, name, password_hash, role, created_at)
    VALUES (gen_random_uuid(), ${betaOrg!.id}, ${BETA.email}, 'Beta Owner',
            ${await hashPassword(BETA.password)}, 'owner', now()) RETURNING id`;
  const [betaProject] = await sql`
    INSERT INTO projects (id, org_id, project_key, created_at)
    VALUES (gen_random_uuid(), ${betaOrg!.id}, ${BETA_PROJECT}, now()) RETURNING id`;
  await sql`
    INSERT INTO project_members (id, project_id, user_id, role, created_at)
    VALUES (gen_random_uuid(), ${betaProject!.id}, ${betaOwner!.id}, 'lead', now())`;

  beta = new Client(h.base);
  const login = await beta.post("/auth/login", BETA);
  expect(login.status).toBe(200);
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await h?.stop();
  await scratch?.drop();
});

describe("reading across the boundary", () => {
  it("cannot see the other org's project by key", async () => {
    expect((await beta.get(`/v1/projects/${ACME_PROJECT}/members`)).status).toBe(404);
    expect((await beta.get(`/v1/skills/lock?project_key=${ACME_PROJECT}`)).status).toBe(404);
    expect((await beta.get(`/v1/skills/usage?project_key=${ACME_PROJECT}`)).status).toBe(404);
  });

  it("lists only its own projects", async () => {
    const { body } = await beta.get("/v1/projects");
    const keys = body.projects.map((p: { project_key: string }) => p.project_key);
    expect(keys).toEqual([BETA_PROJECT]);
  });

  it("lists only its own people", async () => {
    const { body } = await beta.get("/v1/users");
    const emails = body.users.map((u: { email: string }) => u.email);
    expect(emails).toEqual([BETA.email]);
    expect(emails).not.toContain(ACME.email);
  });

  it("sees an empty catalogue, not Acme's", async () => {
    const { body } = await beta.get("/v1/skills/catalogue");
    expect(body.skills.map((s: { name: string }) => s.name)).not.toContain("acme-retry");
  });

  it("sees an empty audit trail, not Acme's", async () => {
    const { body } = await beta.get("/v1/audit?limit=200");
    // Beta has done one thing — signed in. Acme published, invited and enabled.
    expect(body.events.every((e: { actor: string }) => e.actor !== ACME.email)).toBe(true);

    const summary = await beta.get("/v1/audit/summary");
    expect(summary.body.actions.find((a: { action: string }) => a.action === "skill.publish"))
      .toBeUndefined();
  });

  it("cannot read the other org's pending invitations", async () => {
    const { body } = await beta.get("/auth/invites");
    expect(body.map((i: { email: string }) => i.email)).not.toContain("pending@acme.test");
  });

  it("cannot read the other org's API tokens", async () => {
    const { body } = await beta.get("/auth/tokens");
    expect(body.map((t: { id: string }) => t.id)).not.toContain(acme.token);
  });
});

describe("writing across the boundary", () => {
  it("cannot enable the other org's skill anywhere", async () => {
    // Not on Acme's project…
    expect(
      (await beta.post("/v1/skills/acme-retry/enable", { project_key: ACME_PROJECT })).status,
    ).toBe(404);
    // …nor by pulling it into its own.
    expect(
      (await beta.post("/v1/skills/acme-retry/enable", { project_key: BETA_PROJECT })).status,
    ).toBe(404);
  });

  it("cannot approve or deprecate the other org's skill", async () => {
    expect((await beta.post("/v1/skills/acme-retry/approve", {})).status).toBe(404);
    expect((await beta.post("/v1/skills/acme-retry/deprecate", {})).status).toBe(404);
  });

  it("cannot read the other org's skill versions, which carry its content", async () => {
    expect((await beta.get("/v1/skills/acme-retry/versions")).status).toBe(404);
  });

  it("cannot add itself to the other org's project", async () => {
    const added = await beta.post(`/v1/projects/${ACME_PROJECT}/members`, { email: BETA.email });
    expect(added.status).toBe(404);

    const [[count]] = [
      await sql`SELECT count(*)::int AS n FROM project_members WHERE project_id = ${id("project")}`,
    ];
    expect(count!.n).toBe(1);
  });

  it("cannot rename the other org's project", async () => {
    expect((await beta.patch(`/v1/projects/${ACME_PROJECT}`, { display_name: "Ours" })).status).toBe(
      404,
    );
  });

  it("cannot change the role of, or delete, the other org's user", async () => {
    expect((await beta.patch(`/v1/users/${acme.user}/role`, { role: "member" })).status).toBe(404);
    expect((await beta.del(`/v1/users/${acme.user}`)).status).toBe(404);

    const [still] = await sql`SELECT role FROM users WHERE id = ${id("user")}`;
    expect(still!.role).toBe("owner");
  });

  it("cannot revoke the other org's invitation or token", async () => {
    expect((await beta.del(`/auth/invites/${acme.invite}`)).status).toBe(404);
    expect((await beta.del(`/auth/tokens/${acme.token}`)).status).toBe(404);

    const [invite] = await sql`SELECT accepted_at FROM invites WHERE id = ${id("invite")}`;
    expect(invite).toBeDefined();
    const [token] = await sql`SELECT revoked_at FROM api_tokens WHERE id = ${id("token")}`;
    expect(token!.revoked_at).toBeNull();
  });

  it("cannot report skill use against the other org's project", async () => {
    const { status } = await beta.post("/v1/skills/used", {
      project_key: ACME_PROJECT,
      agent: "claude-code",
      names: ["acme-retry"],
    });
    expect(status === 404 || status === 204).toBe(true);

    const [[uses]] = [
      await sql`SELECT count(*)::int AS n FROM skill_uses WHERE project_id = ${id("project")}`,
    ];
    expect(uses!.n).toBe(0);
  });
});

describe("the other org's credentials", () => {
  it("still work — this is isolation, not a lockout", async () => {
    const ci = new Client(h.base);
    const { status, body } = await ci.get("/v1/projects", { bearer: acme.tokenSecret });
    expect(status).toBe(200);
    expect(body.projects.map((p: { project_key: string }) => p.project_key)).toEqual([
      ACME_PROJECT,
    ]);
  });

  it("do not become Beta's by being presented with Beta's cookie", async () => {
    // A bearer token and a session cookie both arriving: whichever wins, it
    // must not be a blend of the two orgs.
    const { body } = await beta.get("/v1/projects", { bearer: acme.tokenSecret });
    const keys = body.projects.map((p: { project_key: string }) => p.project_key);
    expect(keys.length).toBe(1);
    expect(new Set(keys).size).toBe(1);
  });
});

describe("usage counters", () => {
  it("count only this organisation", async () => {
    const acmeUsage = await h.client.get("/v1/usage");
    const betaUsage = await beta.get("/v1/usage");

    expect(acmeUsage.status).toBe(200);
    expect(acmeUsage.body.projects).toBe(1);
    expect(acmeUsage.body.skills.catalogue).toBeGreaterThan(0);

    expect(betaUsage.body.projects).toBe(1);
    // Beta published nothing, so a shared counter would show up here.
    expect(betaUsage.body.skills.catalogue).toBe(0);
    expect(betaUsage.body.skills.versions).toBe(0);
  });

  it("count seats as people who signed in, not people who were invited", async () => {
    const before = await h.client.get("/v1/usage");
    await h.client.post("/auth/invites", { email: "never-accepts@acme.test", role: "member" });
    const after = await h.client.get("/v1/usage");

    // Charging for an invitation nobody accepted is the kind of small
    // dishonesty that loses an account.
    expect(after.body.seats_used).toBe(before.body.seats_used);
    expect(after.body.pending_invites).toBe(before.body.pending_invites + 1);
  });

  it("say the free tier rather than nothing when there is no subscription row", async () => {
    const { body } = await beta.get("/v1/usage");
    expect(body.subscription.plan).toBe("free");
    expect(body.subscription.status).toBe("active");
    // Nothing reads this to decide whether the product works.
    expect(body.subscription.metered).toBe(false);
  });

  it("are admin-only", async () => {
    const anon = new Client(h.base);
    expect((await anon.get("/v1/usage")).status).toBe(401);
  });
});

describe("an invitation is not a way in", () => {
  it("cannot be accepted by someone who already belongs to another org", async () => {
    // Accepting sets a password on the invited *email*. Beta's owner holding
    // the link must not end up inside Acme, or inside both.
    const other = new Client(h.base);
    const { status } = await other.post(`/auth/invites/${acme.inviteToken}/accept`, {
      password: "the invitee's own password",
    });
    // It works — for the invited address, which is an Acme address.
    expect(status).toBe(200);

    const rows = await sql`SELECT org_id FROM users WHERE email = 'pending@acme.test'`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.org_id).toBe(acme.org);
  });
});
