/**
 * The one door a stranger can write to.
 *
 * Everything else in the product needs a session or a token; the landing
 * page's form does not, which makes this the endpoint worth being unfriendly
 * about. These check what it accepts, what it refuses, and — the part that
 * matters most — that the queue it fills cannot be read by the people it is
 * about.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;

const OWNER = { email: "owner@acme.test", password: "correct horse battery" };

beforeAll(async () => {
  scratch = await scratchDatabase();
  h = await startServer(scratch.url, { LANDING_ORIGIN: "https://drymem.test" });
  await h.client.post(
    "/auth/signup",
    { org_name: "Acme", email: OWNER.email, password: OWNER.password, name: "Owner" },
    { web: true },
  );
}, 120_000);

afterAll(async () => {
  await h?.stop();
  await scratch?.drop();
});

const ask = (over: Record<string, unknown> = {}) =>
  new Client(h.base).post(
    "/access-requests",
    { email: "jose@acme.test", name: "Jose", company: "Acme", about: "We keep re-deciding things.", team_size: "5", ...over },
    { web: true },
  );

describe("asking for access", () => {
  it("takes the request and says a person will answer", async () => {
    const { status, body } = await ask();
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.detail).toMatch(/hear from us/i);
  });

  it("refuses something that is not an address", async () => {
    expect((await ask({ email: "not-an-address" })).status).toBe(400);
  });

  it("caps what a stranger can store", async () => {
    expect((await ask({ about: "x".repeat(2001) })).status).toBe(400);
    expect((await ask({ company: "y".repeat(201) })).status).toBe(400);
  });

  it("ignores fields it was not asked for", async () => {
    // A closed schema: `status` is the operator's decision, never the caller's.
    expect((await ask({ status: "approved", email: "sneak@acme.test" })).status).toBe(201);
    const queue = await h.client.get("/access-requests?status=pending");
    expect(queue.body.some((r: { email: string }) => r.email === "sneak@acme.test")).toBe(true);
  });

  // Last in this block on purpose: every call above spends one of the five, so
  // by here the budget is gone and the throttle is the thing being observed.
  it("throttles a stranger who keeps asking", async () => {
    expect((await ask()).status).toBe(429);
  });
});

describe("the queue", () => {
  it("is invisible to anyone who is not signed in", async () => {
    expect((await new Client(h.base).get("/access-requests")).status).toBe(401);
  });

  it("is invisible to a member", async () => {
    const invite = await h.client.post("/auth/invites", { email: "member@acme.test" }, { web: true });
    const member = new Client(h.base);
    await member.post(
      `/auth/invites/${invite.body.invite_url.split("/").pop()}/accept`,
      { password: "another long password here" },
      { web: true },
    );
    expect((await member.get("/access-requests")).status).toBe(403);
  });

  it("records who decided, and shows up in the audit", async () => {
    const { body: queue } = await h.client.get("/access-requests?status=pending");
    const first = queue[0];
    const { status, body } = await h.client.patch(
      `/access-requests/${first.id}`,
      { status: "approved", note: "free trial" },
      { web: true },
    );
    expect(status).toBe(200);
    expect(body.status).toBe("approved");

    const { body: after } = await h.client.get("/access-requests?status=approved");
    expect(after.some((r: { id: string }) => r.id === first.id)).toBe(true);

    const { body: audit } = await h.client.get("/v1/audit");
    const entries = audit.entries ?? audit;
    expect(JSON.stringify(entries)).toContain("access.approved");
  });

  it("refuses a status nobody defined", async () => {
    const { body: queue } = await h.client.get("/access-requests?status=all");
    const { status } = await h.client.patch(
      `/access-requests/${queue[0].id}`,
      { status: "vip" },
      { web: true },
    );
    expect(status).toBe(400);
  });
});

describe("the landing page's origin", () => {
  it("is allowed, and nothing else is", async () => {
    const allowed = await fetch(`${h.base}/access-requests`, {
      method: "OPTIONS",
      headers: { Origin: "https://drymem.test" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://drymem.test");

    const stranger = await fetch(`${h.base}/access-requests`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.test" },
    });
    expect(stranger.status).toBe(403);
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
  });
});
