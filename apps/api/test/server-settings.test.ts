/**
 * Settings an owner can change from the console.
 *
 * The rules worth a test are the refusals: a secret must never come back out,
 * a member must not be able to read or change any of it, and clearing a setting
 * has to fall back to the environment rather than turning email off.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;
let member: Client;

const OWNER = { email: "owner@acme.test", password: "correct horse battery" };

beforeAll(async () => {
  scratch = await scratchDatabase();
  h = await startServer(scratch.url);
  await h.client.post(
    "/auth/signup",
    { org_name: "Acme", email: OWNER.email, password: OWNER.password, name: "Owner" },
    { web: true },
  );

  const invite = await h.client.post("/auth/invites", { email: "member@acme.test" }, { web: true });
  member = new Client(h.base);
  await member.post(
    `/auth/invites/${invite.body.invite_url.split("/").pop()}/accept`,
    { password: "another long password here" },
    { web: true },
  );
}, 120_000);

afterAll(async () => {
  await h?.stop();
  await scratch?.drop();
});

describe("who may see them", () => {
  it("refuses a stranger", async () => {
    expect((await new Client(h.base).get("/v1/server-settings")).status).toBe(401);
  });

  it("refuses a member", async () => {
    expect((await member.get("/v1/server-settings")).status).toBe(403);
    expect((await member.patch("/v1/server-settings", { email_from: "x@y.test" }, { web: true })).status).toBe(403);
  });
});

describe("secrets go in and do not come back", () => {
  it("never returns the key it was given", async () => {
    await h.client.patch(
      "/v1/server-settings",
      { resend_api_key: "re_a_real_looking_key_9876" },
      { web: true },
    );
    const { body } = await h.client.get("/v1/server-settings");

    expect(JSON.stringify(body)).not.toContain("re_a_real_looking_key_9876");
    expect(body.email.configured).toBe(true);
    // Enough to recognise what you set, useless to anyone who did not set it.
    expect(body.email.api_key_hint).toBe("…9876");
  });

  it("says when the value in force came from the environment", async () => {
    const { body } = await h.client.get("/v1/server-settings");
    // A key was saved above, so this one is not the environment's.
    expect(body.email.from_environment).toBe(false);
  });
});

describe("changing them", () => {
  it("leaves out what was not sent", async () => {
    await h.client.patch("/v1/server-settings", { email_from: "drymem <hi@acme.test>" }, { web: true });
    const { body } = await h.client.get("/v1/server-settings");
    expect(body.email.from_address).toBe("drymem <hi@acme.test>");
    // The key from the previous test is untouched by a patch that omitted it.
    expect(body.email.api_key_hint).toBe("…9876");
  });

  it("clears a setting back to the environment rather than to nothing", async () => {
    await h.client.patch("/v1/server-settings", { email_from: null }, { web: true });
    const { body } = await h.client.get("/v1/server-settings");
    expect(body.email.from_address).toMatch(/drymem/);
    expect(body.email.from_address).not.toBe("drymem <hi@acme.test>");
  });

  it("refuses an extractor nobody implemented", async () => {
    const { status } = await h.client.patch("/v1/server-settings", { extractor: "gpt" }, { web: true });
    expect(status).toBe(400);
  });

  it("records which settings were touched, and none of their values", async () => {
    await h.client.patch("/v1/server-settings", { anthropic_api_key: "sk-ant-secret-value" }, { web: true });
    const { body } = await h.client.get("/v1/audit");
    const entries = JSON.stringify(body.entries ?? body);
    expect(entries).toContain("server.settings");
    expect(entries).toContain("anthropic_api_key");
    expect(entries).not.toContain("sk-ant-secret-value");
  });
});

describe("what is deliberately absent", () => {
  it("offers no way to move the databases", async () => {
    const { body } = await h.client.get("/v1/server-settings");
    const shown = JSON.stringify(body).toLowerCase();
    expect(shown).not.toContain("database_url");
    expect(shown).not.toContain("neo4j");
    // And a patch that tries anyway changes nothing.
    await h.client.patch(
      "/v1/server-settings",
      { database_url: "postgres://attacker/db", neo4j_uri: "bolt://attacker" },
      { web: true },
    );
    const after = await h.client.get("/v1/server-settings");
    expect(JSON.stringify(after.body)).not.toContain("attacker");
  });
});
