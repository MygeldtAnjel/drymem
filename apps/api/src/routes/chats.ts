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
import { and, count, desc, eq } from "drizzle-orm";
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

const messagesOf = (chatId: string) =>
  db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.chatId, chatId))
    .orderBy(schema.chatMessages.createdAt);

chatRouter.get("/", async (req, res) => {
  const principal = principalOf(req);
  const query = z.object({ project_key: z.string().max(500) }).parse(req.query);
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
    .where(and(eq(schema.chats.projectId, project.id), eq(schema.chats.userId, principal.userId)))
    .groupBy(schema.chats.id)
    .orderBy(desc(schema.chats.updatedAt))
    .limit(50);

  res.json({ chats: rows });
});

chatRouter.get("/:id", async (req, res) => {
  const principal = principalOf(req);
  const chat = await chatFor(principal.orgId, principal.userId, param(req, "id"));
  const messages = await messagesOf(chat.id);

  res.json({
    id: chat.id,
    title: chat.title,
    updated_at: chat.updatedAt,
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
): Promise<EngineAnswer> {
  const response = await fetch(new URL("/v1/ask", env.MEMORY_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Drymem-Principal": await signPrincipal(principal),
    },
    body: JSON.stringify({ project_key: projectKey, question, history }),
    // A local model takes its time. Node's default would give up first and
    // report a network failure for an answer that was on its way.
    signal: AbortSignal.timeout(180_000),
  });
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

  const history = existing
    ? (await messagesOf(existing.id)).slice(-HISTORY_TURNS).map((m) => ({
        role: m.role,
        content: m.content,
      }))
    : [];

  // The engine first. A chat row created before an answer that never arrives
  // is an empty conversation in somebody's list with nothing to explain it.
  const result = await askEngine(principal, body.project_key, body.question, history);

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
