/**
 * Chats: asking the project's memory more than one question.
 *
 * Asking used to be a box and an answer, thrown away the moment you navigated.
 * A question is rarely the whole thought — the second one is usually "and why?"
 * — so this keeps the turns, and keeps the list of conversations beside them.
 *
 * **Private to the person who asked.** Every query filters on `user_id` as well
 * as `org_id`. A chat is a record of what somebody did not know, and that is
 * not a thing to hand their team by default.
 *
 * **The answer still comes from the engine**, which owns the model and the
 * retrieval. This app owns the rows: it calls `/v1/ask` with the turns so far,
 * writes both messages, and returns what the engine said. Splitting it the
 * other way — the browser calling the engine and then this app to store it —
 * would let a failed write lose an answer somebody already read.
 *
 * **Citations are stored, not re-derived.** A link in a week-old answer should
 * point at the memory that was cited, not at whatever the same question
 * retrieves today.
 */

import { Router } from "express";
import { and, count, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client.js";
import type { ChatSource } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, notFound } from "../lib/errors.js";
import { param } from "../lib/params.js";
import { signPrincipal, type Principal } from "../lib/principal.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const chatRouter = Router();
chatRouter.use(requireUser);

/** A conversation is long before it is interesting; the model sees the tail. */
const HISTORY_TURNS = 10;
const TITLE_CHARS = 120;

/** The project, if this person can see it. 404 rather than 403, as everywhere. */
async function projectFor(orgId: string, userId: string, key: string) {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(
      and(
        eq(schema.projects.projectKey, key),
        eq(schema.projects.orgId, orgId),
        eq(schema.projectMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("No such project.");
  return row;
}

/** Somebody else's chat is not found, not forbidden. */
async function chatFor(orgId: string, userId: string, id: string) {
  const [chat] = await db
    .select()
    .from(schema.chats)
    .where(
      and(eq(schema.chats.id, id), eq(schema.chats.orgId, orgId), eq(schema.chats.userId, userId)),
    )
    .limit(1);
  if (!chat) throw notFound("No such chat.");
  return chat;
}

/**
 * The newest `limit` messages in a chat, oldest-first for rendering.
 *
 * Newest rather than oldest because a transcript is read from the bottom: you
 * open a chat to see how it ended. `before` walks backwards from there.
 *
 * Ordered by `seq`, never by `created_at` — both rows of a turn are written in
 * one statement and share a timestamp exactly, so ordering by time is a tie
 * that can put an answer above its own question.
 */
async function messagesOf(chatId: string, limit: number, before?: number) {
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.chatId, chatId),
        ...(before ? [lt(schema.chatMessages.seq, before)] : []),
      ),
    )
    .orderBy(desc(schema.chatMessages.seq))
    .limit(limit);
  return rows.reverse();
}

/** How many turns of a transcript arrive with a chat, and per scroll after it. */
const MESSAGE_PAGE = 40;

/** A page of conversations. This list grows for as long as somebody uses it. */
const listSchema = z.object({
  project_key: z.string().max(500),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  /** Cursor: the `next_before` from the previous page. */
  before: z.coerce.date().optional(),
});

chatRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const query = listSchema.parse(req.query);
  const project = await projectFor(principal.orgId, principal.userId, query.project_key);

  const rows = await db
    .select({
      id: schema.chats.id,
      title: schema.chats.title,
      updated_at: schema.chats.updatedAt,
      messages: count(schema.chatMessages.id),
    })
    .from(schema.chats)
    .leftJoin(schema.chatMessages, eq(schema.chatMessages.chatId, schema.chats.id))
    .where(
      and(
        eq(schema.chats.projectId, project.id),
        eq(schema.chats.userId, principal.userId),
        ...(query.before ? [lt(schema.chats.updatedAt, query.before)] : []),
      ),
    )
    .groupBy(schema.chats.id)
    .orderBy(desc(schema.chats.updatedAt))
    .limit(query.limit);

  res.json({
    chats: rows,
    // A short page is the last page, so the caller never asks for nothing.
    next_before: rows.length === query.limit ? rows[rows.length - 1]!.updated_at : null,
  });
});

const transcriptSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(MESSAGE_PAGE),
  /** Cursor: the `next_before` from the previous page, walking backwards. */
  before: z.coerce.number().int().min(1).optional(),
});

chatRouter.get("/:id", async (req, res) => {
  const principal = principalOf(req);
  const chat = await chatFor(principal.orgId, principal.userId, param(req, "id"));
  const query = transcriptSchema.parse(req.query);
  const messages = await messagesOf(chat.id, query.limit, query.before);

  res.json({
    id: chat.id,
    title: chat.title,
    updated_at: chat.updatedAt,
    // The oldest message on this page is the cursor for the one before it. A
    // short page means the top of the conversation.
    next_before: messages.length === query.limit ? messages[0]!.seq : null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
      grounded: m.grounded,
      model: m.model,
      created_at: m.createdAt,
    })),
  });
});

chatRouter.delete("/:id", async (req, res) => {
  const principal = principalOf(req);
  const chat = await chatFor(principal.orgId, principal.userId, param(req, "id"));
  // The messages go with it: `chat_messages.chat_id` cascades.
  await db.delete(schema.chats).where(eq(schema.chats.id, chat.id));
  res.status(204).end();
});

interface EngineAnswer {
  answer: string;
  model: string;
  grounded: boolean;
  sources: ChatSource[];
}

/** Ask the engine. It owns the model and the retrieval; this app owns the rows. */
async function askEngine(
  principal: Principal,
  projectKey: string,
  question: string,
  history: { role: string; content: string }[],
  carry: string[],
): Promise<EngineAnswer> {
  let response: Response;
  try {
    response = await fetch(new URL("/v1/ask", env.MEMORY_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Drymem-Principal": await signPrincipal(principal),
      },
      body: JSON.stringify({ project_key: projectKey, question, history, carry }),
      // A local model takes its time. Node's default would give up first and
      // report a network failure for an answer that was on its way.
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    // The engine being down or slow is not this request's fault. Unhandled, it
    // surfaced as a 500 and an "unhandled" trace in the log with no sign of
    // which route threw it.
    throw badRequest("The memory engine did not answer. It may be starting up.");
  }
  if (!response.ok) {
    throw badRequest(`The memory engine replied ${response.status}.`);
  }
  return (await response.json()) as EngineAnswer;
}

const askSchema = z.object({
  project_key: z.string().max(500),
  question: z.string().min(3).max(500),
  /** Absent starts a new conversation; present continues one. */
  chat_id: z.string().max(64).optional(),
});

chatRouter.post("/ask", async (req, res) => {
  const principal = principalOf(req);
  const body = askSchema.parse(req.body);
  const project = await projectFor(principal.orgId, principal.userId, body.project_key);

  const existing = body.chat_id
    ? await chatFor(principal.orgId, principal.userId, body.chat_id)
    : null;

  // Only the tail the model is shown. This used to read the whole transcript
  // out of Postgres in order to throw all but the last ten rows away.
  const earlier = existing ? await messagesOf(existing.id, HISTORY_TURNS) : [];
  const history = earlier.map((m) => ({ role: m.role, content: m.content }));

  /*
   * What the conversation is about, as memory uuids.
   *
   * A follow-up often carries no subject — "was it complex?", then "and what
   * files did he change?". Retrieving on those words alone lost the thread
   * entirely. The memories the last answer stood on are the subject, so they
   * travel with the question.
   */
  const carry = [
    ...new Set(
      earlier
        .filter((m) => m.role === "assistant")
        .slice(-1)
        .flatMap((m) => m.sources.map((s) => s.uuid)),
    ),
  ];

  // The engine first. A chat row created before an answer that never arrives
  // is an empty conversation in somebody's list with nothing to explain it.
  const result = await askEngine(principal, body.project_key, body.question, history, carry);

  const chat =
    existing ??
    (
      await db
        .insert(schema.chats)
        .values({
          orgId: principal.orgId,
          projectId: project.id,
          userId: principal.userId,
          title: body.question.slice(0, TITLE_CHARS),
        })
        .returning()
    )[0]!;

  const [, answer] = await db
    .insert(schema.chatMessages)
    .values([
      { chatId: chat.id, role: "user", content: body.question, sources: [], grounded: true },
      {
        chatId: chat.id,
        role: "assistant",
        content: result.answer,
        sources: result.sources ?? [],
        grounded: result.grounded,
        model: result.model,
      },
    ])
    .returning();

  if (existing) {
    await db
      .update(schema.chats)
      .set({ updatedAt: new Date() })
      .where(eq(schema.chats.id, chat.id));
  }

  res.json({
    chat_id: chat.id,
    title: chat.title,
    message: {
      id: answer!.id,
      role: "assistant",
      content: answer!.content,
      sources: answer!.sources,
      grounded: answer!.grounded,
      model: answer!.model,
      created_at: answer!.createdAt,
    },
  });
});
