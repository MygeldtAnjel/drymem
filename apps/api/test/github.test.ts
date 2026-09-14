/**
 * Signing in with GitHub.
 *
 * Three things here would be a way into somebody else's organisation if they
 * were wrong, so they are what this tests: a missing or mismatched state, an
 * email GitHub has not verified, and an address with no drymem account behind
 * it. The happy path matters less — it fails loudly.
 *
 * GitHub itself is stubbed at `fetch`. The alternative is a test that needs an
 * OAuth app and the internet, which is a test nobody runs.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;
let sql: ReturnType<typeof postgres>;

const OWNER = { email: "owner@acme.test", password: "correct horse battery" };

beforeAll(async () => {
  scratch = await scratchDatabase();
  h = await startServer(scratch.url, {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
  });
  sql = postgres(scratch.url, { max: 2 });
  await h.client.post("/auth/signup", {
    org_name: "Acme",
    email: OWNER.email,
    password: OWNER.password,
    name: "",
  });
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await h?.stop();
  await scratch?.drop();
});

afterEach(() => vi.unstubAllGlobals());

/** GitHub's three calls: the code exchange, the user, and their addresses. */
function stubGithub(emails: { email: string; primary: boolean; verified: boolean }[]) {
  // Anything that is not github.com goes to the real `fetch` — the test client
  // talks to the server under test the same way.
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("login/oauth/access_token")) return json({ access_token: "gho_test" });
    if (url.endsWith("api.github.com/user")) return json({ login: "miguel", name: "Miguel Rojas" });
    if (url.endsWith("/user/emails")) return json(emails);
    return real(input, init);
  });
}

const verified = (email: string) => [{ email, primary: true, verified: true }];

/** The redirect's `error=` query, decoded, or "" when it signed the person in. */
function errorIn(location: string | undefined): string {
  const at = (location ?? "").indexOf("error=");
  return at === -1 ? "" : decodeURIComponent((location ?? "").slice(at + 6));
}

describe("starting the flow", () => {
  it("sends the person to GitHub with a state cookie", async () => {
    const { status, headers } = await h.client.get("/auth/github");
    expect(status).toBe(302);
    expect(headers.get("location")).toContain("github.com/login/oauth/authorize");
    // The address is not in the default scope, and it is the whole point.
    expect(headers.get("location")).toContain("user%3Aemail");
    expect(headers.get("set-cookie")).toContain("drymem_oauth_state=");
  });

  it("is not offered at all when the server has no OAuth app", async () => {
    const plain = await startServer(scratch.url);
    try {
      const bootstrap = await plain.client.get("/auth/bootstrap");
      expect(bootstrap.body.github_enabled).toBe(false);
      expect((await plain.client.get("/auth/github")).status).toBe(404);
    } finally {
      await plain.stop();
    }
  }, 60_000);

  it("says so in bootstrap when it is configured", async () => {
    const { body } = await h.client.get("/auth/bootstrap");
    expect(body.github_enabled).toBe(true);
  });
});

describe("coming back", () => {
  it("refuses a callback with no state cookie", async () => {
    // A link fed to a victim's browser carrying the attacker's code.
    stubGithub(verified(OWNER.email));
    const naked = new Client(h.base);
    const { status, headers } = await naked.get("/auth/github/callback?code=x&state=guessed");

    expect(status).toBe(302);
    expect(errorIn(headers.get("location") ?? undefined)).toMatch(/expired/i);
    expect(headers.get("set-cookie") ?? "").not.toContain("drymem_session=");
  });

  it("refuses a state that does not match the cookie", async () => {
    stubGithub(verified(OWNER.email));
    const client = new Client(h.base);
    await client.get("/auth/github");

    const { headers } = await client.get("/auth/github/callback?code=x&state=not-it");
    expect(errorIn(headers.get("location") ?? undefined)).toMatch(/expired/i);
    expect(headers.get("set-cookie") ?? "").not.toContain("drymem_session=");
  });

  it("refuses an email GitHub has not verified", async () => {
    // Otherwise anyone takes over an account by adding its address to their
    // GitHub profile and never confirming it.
    stubGithub([{ email: OWNER.email, primary: true, verified: false }]);
    const client = new Client(h.base);
    const state = await startAndReadState(client);

    const { headers } = await client.get(`/auth/github/callback?code=x&state=${state}`);
    expect(errorIn(headers.get("location") ?? undefined)).toMatch(/verified/i);
    expect(headers.get("set-cookie") ?? "").not.toContain("drymem_session=");
  });

  it("refuses a verified email that is not the primary one", async () => {
    stubGithub([
      { email: OWNER.email, primary: false, verified: true },
      { email: "someone@else.test", primary: true, verified: true },
    ]);
    const client = new Client(h.base);
    const state = await startAndReadState(client);

    const { headers } = await client.get(`/auth/github/callback?code=x&state=${state}`);
    // The primary address has no account, so it stops there.
    expect(errorIn(headers.get("location") ?? undefined)).toMatch(/No drymem account/i);
  });

  it("does not create an account for a stranger", async () => {
    // drymem is invitation-only after the first account. GitHub signs you in;
    // it does not let you in.
    stubGithub(verified("stranger@nowhere.test"));
    const client = new Client(h.base);
    const state = await startAndReadState(client);

    const { headers } = await client.get(`/auth/github/callback?code=x&state=${state}`);
    expect(errorIn(headers.get("location") ?? undefined)).toMatch(/Ask an admin for an invitation/);

    const rows = await sql`SELECT id FROM users WHERE email = 'stranger@nowhere.test'`;
    expect(rows.length).toBe(0);
  });

  it("signs in an existing account and fills in a missing name", async () => {
    stubGithub(verified(OWNER.email));
    const client = new Client(h.base);
    const state = await startAndReadState(client);

    const { status, headers } = await client.get(`/auth/github/callback?code=x&state=${state}`);
    expect(status).toBe(302);
    expect(errorIn(headers.get("location") ?? undefined)).toBe("");

    // The session works for a normal call afterwards.
    const me = await client.get("/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(OWNER.email);
    expect(me.body.name).toBe("Miguel Rojas");
  });

  it("records the sign-in with the GitHub login", async () => {
    const { body } = await h.client.get("/v1/audit?action=user.login");
    const viaGithub = body.events.find((e: { target: string }) => e.target?.startsWith("github:"));
    expect(viaGithub.target).toBe("github:miguel");
  });

  it("never overwrites a name the person set here", async () => {
    await h.client.patch("/v1/me", { name: "Miguel B." });
    stubGithub(verified(OWNER.email));
    const client = new Client(h.base);
    const state = await startAndReadState(client);
    await client.get(`/auth/github/callback?code=x&state=${state}`);

    const [user] = await sql`SELECT name FROM users WHERE email = ${OWNER.email}`;
    expect(user!.name).toBe("Miguel B.");
  });
});

/** Begin the flow and read back the state the server set. */
async function startAndReadState(client: Client): Promise<string> {
  const { headers } = await client.get("/auth/github");
  const cookie = headers.get("set-cookie") ?? "";
  return /drymem_oauth_state=([^;]+)/.exec(cookie)?.[1] ?? "";
}
