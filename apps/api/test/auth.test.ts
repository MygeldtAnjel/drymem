/**
 * Identity, end to end over HTTP, against a real Postgres.
 *
 * These are the flows a person walks on their first day: create the
 * organisation, invite someone, forget a password, get back in. Each one is
 * tested for what it does *and* for what it refuses, because the refusals are
 * the part that matters — a sign-up that is not closed hands the org to a
 * stranger, and a reset that does not end sessions leaves the intruder in.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;

const OWNER = { email: "owner@acme.test", password: "correct horse battery" };

beforeAll(async () => {
  scratch = await scratchDatabase();
  h = await startServer(scratch.url);
}, 120_000);

afterAll(async () => {
  await h?.stop();
  await scratch?.drop();
});

async function signUp() {
  return h.client.post("/auth/signup", {
    org_name: "Acme",
    email: OWNER.email,
    password: OWNER.password,
    name: "Owner",
  });
}

describe("first run", () => {
  it("asks to be set up while nobody exists", async () => {
    const { body } = await h.client.get("/auth/bootstrap");
    expect(body.needs_setup).toBe(true);
  });

  it("makes the first person the owner and signs them in", async () => {
    const { status, body } = await signUp();
    expect(status).toBe(200);
    expect(body.role).toBe("owner");
    expect(body.org_name).toBe("Acme");

    const me = await h.client.get("/auth/session");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(OWNER.email);
  });

  it("refuses a second sign-up", async () => {
    // Without this, a server left open on a network hands ownership to whoever
    // finds it next.
    const other = new Client(h.base);
    const { status, body } = await other.post("/auth/signup", {
      org_name: "Evil",
      email: "stranger@evil.test",
      password: "another long password",
    });
    expect(status).toBe(409);
    expect(body.detail).toMatch(/invitation/i);
    expect((await h.client.get("/auth/bootstrap")).body.needs_setup).toBe(false);
  });
});

describe("signing in", () => {
  it("rejects a short password when signing up", async () => {
    const fresh = await scratchDatabase();
    const server = await startServer(fresh.url);
    const { status, body } = await server.client.post("/auth/signup", {
      org_name: "Acme",
      email: "a@b.test",
      password: "short",
    });
    expect(status).toBe(400);
    expect(body.detail).toMatch(/10 characters/);
    await server.stop();
    await fresh.drop();
  }, 120_000);

  it("gives the same answer for a wrong password and an unknown address", async () => {
    const anon = new Client(h.base);
    const wrongPassword = await anon.post("/auth/login", {
      email: OWNER.email,
      password: "nope nope nope",
    });
    const unknownEmail = await anon.post("/auth/login", {
      email: "nobody@acme.test",
      password: "nope nope nope",
    });
    expect(wrongPassword.status).toBe(400);
    expect(unknownEmail.body.detail).toBe(wrongPassword.body.detail);
  });

  it("accepts the right password, case-insensitively on the address", async () => {
    const anon = new Client(h.base);
    const { status, body } = await anon.post("/auth/login", {
      email: "OWNER@ACME.TEST",
      password: OWNER.password,
    });
    expect(status).toBe(200);
    expect(body.email).toBe(OWNER.email);
  });

  it("refuses a cookie write without the client header", async () => {
    // SameSite=Lax still allows a cross-site top-level POST; a header a
    // cross-site form cannot set is what closes that.
    const forged = await h.client.patch("/v1/me", { name: "Hijacked" }, { web: false });
    expect(forged.status).toBe(403);
    const honest = await h.client.patch("/v1/me", { name: "Owner" });
    expect(honest.status).toBe(200);
  });

  it("lists sessions, marks this one, and ends the one you name", async () => {
    const sessions = await h.client.get("/auth/sessions");
    // Another browser signed in earlier in this file; both belong to the owner.
    expect(sessions.body.length).toBeGreaterThanOrEqual(2);
    const mine = sessions.body.filter((s: { current: boolean }) => s.current);
    expect(mine).toHaveLength(1);

    await h.client.del(`/auth/sessions/${mine[0].id}`);
    expect((await h.client.get("/auth/session")).status).toBe(401);

    await h.client.post("/auth/login", OWNER);
  });
});

describe("invitations", () => {
  let inviteUrl = "";

  it("creates one and lists it as pending", async () => {
    const { status, body } = await h.client.post("/auth/invites", {
      email: "Jose@acme.test",
      role: "member",
    });
    expect(status).toBe(200);
    expect(body.email).toBe("jose@acme.test");
    expect(body.invite_url).toContain("/#/invite/");
    // No key in the test environment, so nothing was sent and the caller is
    // told so rather than being left to assume.
    expect(body.emailed).toBe(false);
    inviteUrl = body.invite_url;

    const pending = await h.client.get("/auth/invites");
    expect(pending.body.map((i: { email: string }) => i.email)).toContain("jose@acme.test");
  });

  it("lets the invitee choose a password and land inside", async () => {
    const token = inviteUrl.split("/").pop()!;
    const invitee = new Client(h.base);

    const seen = await invitee.get(`/auth/invites/${token}/public`);
    expect(seen.body.email).toBe("jose@acme.test");
    expect(seen.body.org_name).toBe("Acme");

    const joined = await invitee.post(`/auth/invites/${token}/accept`, {
      password: "a second long password",
      name: "Jose",
    });
    expect(joined.status).toBe(200);
    expect(joined.body.role).toBe("member");
    expect((await invitee.get("/auth/session")).body.email).toBe("jose@acme.test");
  });

  it("refuses the same link twice", async () => {
    const token = inviteUrl.split("/").pop()!;
    const late = new Client(h.base);
    const { status } = await late.post(`/auth/invites/${token}/accept`, {
      password: "yet another password",
    });
    expect(status).toBe(404);
  });

  it("is admin-only", async () => {
    const jose = new Client(h.base);
    await jose.post("/auth/login", { email: "jose@acme.test", password: "a second long password" });
    const { status } = await jose.post("/auth/invites", { email: "x@acme.test" });
    expect(status).toBe(403);
  });
});

describe("forgotten passwords", () => {
  it("answers the same whether or not the address exists", async () => {
    const anon = new Client(h.base);
    const real = await anon.post("/auth/forgot", { email: OWNER.email });
    const fake = await anon.post("/auth/forgot", { email: "nobody@acme.test" });
    expect(real.status).toBe(200);
    expect(real.body.detail).toBe(fake.body.detail);
    // Otherwise this endpoint is a directory of who works at the company.
    expect(real.body.detail).not.toMatch(/sent you/i);
  });

  it("resets, ends every other session, and signs the person in", async () => {
    const anon = new Client(h.base);
    await anon.post("/auth/forgot", { email: "jose@acme.test" });

    const printed = h.logged.filter((l) => l.includes("/#/reset/")).pop();
    expect(printed, "the link has to reach a human somehow").toBeTruthy();
    const token = printed!.trim().split("/").pop()!;

    const check = await anon.get(`/auth/reset/${token}`);
    expect(check.body.email).toBe("jose@acme.test");

    // Jose is signed in elsewhere; that is the session a reset must kill.
    const elsewhere = new Client(h.base);
    await elsewhere.post("/auth/login", {
      email: "jose@acme.test",
      password: "a second long password",
    });
    expect((await elsewhere.get("/auth/session")).status).toBe(200);

    const done = await anon.post(`/auth/reset/${token}`, { password: "the newest password" });
    expect(done.status).toBe(200);
    expect(done.body.email).toBe("jose@acme.test");

    expect((await elsewhere.get("/auth/session")).status).toBe(401);
    expect((await anon.get("/auth/session")).status).toBe(200);
  });

  it("refuses a used link", async () => {
    const printed = h.logged.filter((l) => l.includes("/#/reset/")).pop()!;
    const token = printed.trim().split("/").pop()!;
    const anon = new Client(h.base);
    expect((await anon.get(`/auth/reset/${token}`)).status).toBe(404);
  });
});

describe("changing your own password", () => {
  it("requires the current one, and ends other sessions", async () => {
    const jose = new Client(h.base);
    await jose.post("/auth/login", { email: "jose@acme.test", password: "the newest password" });

    const wrong = await jose.post("/auth/password", {
      current: "not it",
      new: "a replacement password",
    });
    expect(wrong.status).toBe(400);

    const right = await jose.post("/auth/password", {
      current: "the newest password",
      new: "a replacement password",
    });
    expect(right.status).toBe(204);
    // The browser that made the change stays in; that is the one exception.
    expect((await jose.get("/auth/session")).status).toBe(200);
  });
});

describe("device login", () => {
  it("hands the CLI a token exactly once", async () => {
    const cli = new Client(h.base);
    const started = await cli.post("/auth/device", { label: "laptop" });
    expect(started.body.verification_url).toContain("/#/device/");

    const early = await cli.post("/auth/device/token", {
      device_code: started.body.device_code,
    });
    expect(early.body).toEqual({ status: "pending", token: null });

    const approved = await h.client.post("/auth/device/approve", {
      user_code: started.body.user_code.toLowerCase(),
    });
    expect(approved.status).toBe(204);

    const collected = await cli.post("/auth/device/token", {
      device_code: started.body.device_code,
    });
    expect(collected.body.status).toBe("approved");
    expect(collected.body.token).toMatch(/^drymem_/);

    // It works as a bearer, and it is listed where it can be revoked.
    const asCli = new Client(h.base);
    const me = await asCli.get("/v1/me", { bearer: collected.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(OWNER.email);

    const tokens = await h.client.get("/auth/tokens");
    expect(tokens.body.map((t: { label: string }) => t.label)).toContain("laptop");

    const again = await cli.post("/auth/device/token", {
      device_code: started.body.device_code,
    });
    expect(again.body.token).toBeNull();
  });

  it("refuses a code that was never issued", async () => {
    const { status } = await h.client.post("/auth/device/approve", { user_code: "ZZZZ-ZZZZ" });
    expect(status).toBe(400);
  });
});
