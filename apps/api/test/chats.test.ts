/**
 * Chats.
 *
 * Two things here would be bugs somebody notices immediately — a conversation
 * that forgets its own turns, and one person seeing another's — so those are
 * what this leans on. The engine is stubbed: it owns the model, and a test that
 * needs Ollama running is a test nobody runs.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

import { Client, scratchDatabase, startServer, type Harness, type Scratch } from "./harness.js";

let scratch: Scratch;
let h: Harness;
let sql: ReturnType<typeof postgres>;
let dev: Client;

const PROJECT = "github.com/acme/payment-ui";
const OWNER = { email: "owner@acme.test", password: "correct horse battery" };
const DEV = { email: "dev@acme.test", password: "a developer's password" };

/** What the engine was asked, newest last, so a test can inspect it. */
let asked: {
  question: string;
  history: { role: string; content: string }[];
  carry: string[];
}[] = [];

function stubEngine(answer = "Thirty seconds [1].", grounded = true) {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("/v1/ask")) return real(input, init);

    const body = JSON.parse(String(init?.body ?? "{}"));
    asked.push({ question: body.question, history: body.history ?? [], carry: body.carry ?? [] });
    return new Response(
      JSON.stringify({
        answer,
        model: "fake-model",
        grounded,
        sources: grounded
          ? [
              {
                index: 1,
                uuid: "ep-1",
                title: "Retry cap",
                author: OWNER.email,
                type: "decision",
                created_at: "2026-09-01T00:00:00Z",
              },
            ]
          : [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
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

  const [org] = await sql`SELECT id FROM orgs LIMIT 1`;
  const [owner] = await sql`SELECT id FROM users WHERE email = ${OWNER.email}`;
  const [project] = await sql`
    INSERT INTO projects (id, org_id, project_key, created_at)
    VALUES (gen_random_uuid(), ${org!.id}, ${PROJECT}, now()) RETURNING id`;
  await sql`
    INSERT INTO project_members (id, project_id, user_id, role, created_at)
    VALUES (gen_random_uuid(), ${project!.id}, ${owner!.id}, 'lead', now())`;

  const invited = await h.client.post("/auth/invites", { email: DEV.email, role: "member" });
  dev = new Client(h.base);
  await dev.post(`/auth/invites/${invited.body.invite_url.split("/").pop()}/accept`, {
    password: DEV.password,
  });
  const [devUser] = await sql`SELECT id FROM users WHERE email = ${DEV.email}`;
  await sql`
    INSERT INTO project_members (id, project_id, user_id, role, created_at)
    VALUES (gen_random_uuid(), ${project!.id}, ${devUser!.id}, 'member', now())`;
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await h?.stop();
  await scratch?.drop();
});

afterEach(() => {
  vi.unstubAllGlobals();
  asked = [];
});

describe("asking", () => {
  it("starts a chat and titles it from the question", async () => {
    stubEngine();
    const { status, body } = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "What is the retry cap?",
    });

    expect(status).toBe(200);
    expect(body.chat_id).toBeTruthy();
    expect(body.title).toBe("What is the retry cap?");
    expect(body.message.content).toBe("Thirty seconds [1].");
    expect(body.message.model).toBe("fake-model");
  });

  it("keeps both turns, in order", async () => {
    stubEngine();
    const started = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Why does it cap?",
    });

    const { body } = await h.client.get(`/v1/chats/${started.body.chat_id}`);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(body.messages[0].content).toBe("Why does it cap?");
  });

  it("sends the conversation so far, so a follow-up means something", async () => {
    stubEngine();
    const first = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "What is the retry cap?",
    });
    await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "And why?",
      chat_id: first.body.chat_id,
    });

    // The first ask carried nothing; the second carried both earlier turns.
    expect(asked[0]!.history).toEqual([]);
    expect(asked[1]!.history.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(asked[1]!.history[0]!.content).toBe("What is the retry cap?");
  });

  it("carries the last answer's memories into the next question", async () => {
    // A follow-up often has no subject of its own — "was it complex?", then
    // "and what files did he change?". Without this the thread is lost.
    stubEngine();
    const first = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "What was the last decision?",
    });
    await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "and what files did he change?",
      chat_id: first.body.chat_id,
    });

    expect(asked[0]!.carry).toEqual([]);
    expect(asked[1]!.carry).toEqual(["ep-1"]);
  });

  it("carries only the most recent answer's memories", async () => {
    // Three turns deep, the subject is what the *last* answer stood on.
    stubEngine();
    const started = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "First question here",
    });
    for (const q of ["Second question here", "Third question here"]) {
      await h.client.post("/v1/chats/ask", {
        project_key: PROJECT,
        question: q,
        chat_id: started.body.chat_id,
      });
    }
    expect(asked.at(-1)!.carry).toEqual(["ep-1"]);
  });

  it("stores the memories that were cited", async () => {
    stubEngine();
    const started = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Who set the cap?",
    });

    const answer = started.body.message;
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0].uuid).toBe("ep-1");
    // Stored, so the link still points at what was cited a week from now.
    const [row] = await sql`
      SELECT sources FROM chat_messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1`;
    expect(row!.sources).toHaveLength(1);
  });

  it("records an ungrounded answer as ungrounded", async () => {
    stubEngine("Nothing in this project's memory mentions that.", false);
    const { body } = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "What is the airspeed of a swallow?",
    });

    expect(body.message.grounded).toBe(false);
    expect(body.message.sources).toEqual([]);
  });

  it("writes nothing at all when the engine fails", async () => {
    // An empty conversation in somebody's list, with nothing to explain it, is
    // worse than an error.
    const before = await h.client.get(`/v1/chats?project_key=${PROJECT}`);
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/ask")) return new Response("nope", { status: 503 });
      return real(input, init);
    });

    const { status } = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Does this get stored?",
    });
    expect(status).toBe(400);

    const after = await h.client.get(`/v1/chats?project_key=${PROJECT}`);
    expect(after.body.chats.length).toBe(before.body.chats.length);
  });

  it("says so plainly when the engine is not reachable at all", async () => {
    // Not the same as a 503: the connection never opens. Unhandled, this came
    // back as a 500 with an "unhandled" trace and no hint of which route threw.
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/ask")) throw new TypeError("fetch failed");
      return real(input, init);
    });

    const { status, body } = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Is anyone home?",
    });
    expect(status).toBe(400);
    expect(body.detail).toMatch(/did not answer/i);
  });
});

describe("the list", () => {
  it("is newest activity first, with a count", async () => {
    stubEngine();
    const { body } = await h.client.get(`/v1/chats?project_key=${PROJECT}`);

    expect(body.chats.length).toBeGreaterThan(1);
    const times = body.chats.map((c: { updated_at: string }) => c.updated_at);
    expect(times).toEqual([...times].sort().reverse());
    expect(body.chats[0].messages).toBeGreaterThan(0);
  });

  it("is refused for a project the person is not on", async () => {
    const { status } = await h.client.get("/v1/chats?project_key=github.com/acme/other");
    expect(status).toBe(404);
  });
});

describe("whose chat it is", () => {
  it("does not appear in a teammate's list", async () => {
    // A chat records what somebody did not know. That is not their team's.
    const mine = await h.client.get(`/v1/chats?project_key=${PROJECT}`);
    const theirs = await dev.get(`/v1/chats?project_key=${PROJECT}`);

    expect(mine.body.chats.length).toBeGreaterThan(0);
    expect(theirs.body.chats).toEqual([]);
  });

  it("cannot be opened by a teammate who knows its id", async () => {
    const mine = await h.client.get(`/v1/chats?project_key=${PROJECT}`);
    const id = mine.body.chats[0].id;

    expect((await dev.get(`/v1/chats/${id}`)).status).toBe(404);
    expect((await dev.del(`/v1/chats/${id}`)).status).toBe(404);
    // And it is still there.
    expect((await h.client.get(`/v1/chats/${id}`)).status).toBe(200);
  });

  it("cannot be continued by a teammate", async () => {
    stubEngine();
    const mine = await h.client.get(`/v1/chats?project_key=${PROJECT}`);
    const { status } = await dev.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Sneaking in",
      chat_id: mine.body.chats[0].id,
    });
    expect(status).toBe(404);
  });
});

describe("deleting", () => {
  it("takes the messages with it", async () => {
    stubEngine();
    const started = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Delete me afterwards",
    });
    const id = started.body.chat_id;

    expect((await h.client.del(`/v1/chats/${id}`)).status).toBe(204);
    expect((await h.client.get(`/v1/chats/${id}`)).status).toBe(404);

    const rows = await sql`SELECT id FROM chat_messages WHERE chat_id = ${id}`;
    expect(rows.length).toBe(0);
  });
});

describe("a long transcript", () => {
  /** Ask `turns` questions in one chat, and return its id. */
  async function conversation(turns: number): Promise<string> {
    stubEngine();
    const started = await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "Turn number 1 of a long one",
    });
    const id = started.body.chat_id;
    for (let n = 2; n <= turns; n += 1) {
      await h.client.post("/v1/chats/ask", {
        project_key: PROJECT,
        question: `Turn number ${n} of a long one`,
        chat_id: id,
      });
    }
    return id;
  }

  it("opens on the end of the conversation, not the start", async () => {
    // You open a chat to see how it ended, so the newest turns arrive first.
    const id = await conversation(6);
    const { body } = await h.client.get(`/v1/chats/${id}?limit=4`);

    expect(body.messages).toHaveLength(4);
    expect(body.messages.at(-1).role).toBe("assistant");
    expect(body.messages[0].content).toContain("Turn number 5");
    expect(body.next_before).toBeTruthy();
  });

  it("walks backwards to the first message and stops", async () => {
    const id = await conversation(5);
    const seen: string[] = [];
    let before: number | null = null;

    for (let page = 0; page < 20; page += 1) {
      const q = before ? `?limit=4&before=${before}` : "?limit=4";
      const { body } = await h.client.get(`/v1/chats/${id}${q}`);
      // Prepended, because each page is older than the last.
      seen.unshift(...body.messages.map((m: { id: string }) => m.id));
      before = body.next_before;
      if (!before) break;
    }

    expect(before).toBeNull();
    expect(seen.length).toBe(10);
    expect(new Set(seen).size).toBe(10);
  });

  it("keeps a question above its own answer", async () => {
    // Both rows of a turn are written in one statement and share `created_at`
    // exactly, so ordering by time is a tie — and a tie put the answer first.
    const id = await conversation(3);
    const { body } = await h.client.get(`/v1/chats/${id}?limit=100`);

    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("sends the model the tail, not the whole transcript", async () => {
    const id = await conversation(9);
    asked = [];
    stubEngine();
    await h.client.post("/v1/chats/ask", {
      project_key: PROJECT,
      question: "And the last one",
      chat_id: id,
    });

    const history = asked.at(-1)!.history;
    // Ten turns, not eighteen: the tail is what the model is shown.
    expect(history.length).toBeLessThanOrEqual(10);
    // Ending on the answer to the most recent question, in order.
    expect(history.at(-1)!.role).toBe("assistant");
    expect(history.at(-2)!.content).toContain("Turn number 9");
  });
});
