/**
 * Chat: asking the project's memory, and keeping what it said.
 *
 * The old "Ask" was a box and one answer, gone the moment you navigated. A
 * question is rarely the whole thought — the second one is usually "and why?"
 * — so this is a conversation, with the earlier ones listed beside it.
 *
 * Two things make it drymem's rather than a generic chat window.
 *
 * **Every claim carries a citation, and every citation is a link.** The answer
 * is written only from memories the team wrote; the memories it stood on are
 * listed under it and open on click. An answer you cannot check is worse than
 * no answer.
 *
 * **An ungrounded turn says so.** When the memory had nothing, the reply says
 * that plainly and is marked — rather than reading like a fact the project
 * never recorded.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, MessageSquare, Plus, Send, Sparkles, Trash2 } from "lucide-react";

import { Blank, TypeChip } from "@/components/Bits";
import { CatMark } from "@/components/Logo";
import { Markdown } from "@/Markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ChatMessage, ChatSummary } from "@/api";
import { person, relative } from "@/format";
import { go } from "@/router";

/** One page of conversations in the sidebar. This list grows with every question. */
const PAGE = 30;

/**
 * The memories an answer stood on.
 *
 * Cards, not a list of lines. These are the reason to trust the paragraph above
 * them, and a row of `[1] title … author · date` reads as a log dump — the eye
 * has nothing to land on and the numbers stop meaning anything. A card gives
 * each source the number, the kind and the title as three separate things, in
 * that order, which is the order somebody checks them in.
 */
function Sources({ message }: { message: ChatMessage }) {
  // Already filtered and renumbered by the engine: what arrives here is what
  // the answer cited, numbered from one, matching the markers in the prose.
  if (message.sources.length === 0) return null;

  return (
    <div className="mt-4 min-w-0">
      <p className="text-muted-foreground mb-2 text-xs font-medium">
        {message.sources.length === 1 ? "From this memory" : "From these memories"}
      </p>
      <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
        {message.sources.map((source) => (
          <li key={source.uuid} className="min-w-0">
            <button
              className="border-border bg-background hover:border-input hover:bg-muted/40 group flex h-full w-full min-w-0 flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors"
              onClick={() => go("memories", source.uuid)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="bg-muted text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded font-mono text-[10px]">
                  {source.index}
                </span>
                <TypeChip type={source.type} />
              </span>
              <span className="line-clamp-2 min-w-0 text-xs leading-snug font-medium">
                {source.title}
              </span>
              <span className="text-muted-foreground mt-auto flex min-w-0 items-center gap-1 text-[11px]">
                <span className="min-w-0 truncate">
                  {person(source.author, source.author_name)} ·{" "}
                  {relative(source.created_at)}
                </span>
                <ArrowUpRight className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Turn({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="bg-secondary max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 gap-3">
      {/* The cat, small. It marks whose turn this is without a bubble around
          it — an answer is often long, and a box makes it feel quoted. */}
      <span className="border-border bg-card mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border">
        <CatMark className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-relaxed">
          <Markdown source={message.content} />
        </div>
        <Sources message={message} />
        <p className="text-muted-foreground mt-3 text-[11px]">
          {message.grounded
            ? `Written by ${message.model} from these memories, and nothing else.`
            : "Nothing in this project's memory matched, so no model wrote this."}
        </p>
      </div>
    </div>
  );
}

export function ChatPage({ projectKey }: { projectKey: string }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [older, setOlder] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [confirm, setConfirm] = useState<ChatSummary | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  /*
   * Nothing until there is a project to ask about.
   *
   * This page mounts before the workspace has resolved which project is
   * active, and asking for `project_key=` is a 404 in the console on every
   * visit — the kind of noise that hides a real one.
   */
  const refresh = async () => {
    if (!projectKey) return;
    const { api } = await import("@/api");
    await api
      .chats(projectKey, PAGE)
      .then((page) => {
        setChats(page.chats);
        setMore(page.next_before);
      })
      .catch(() => {
        setChats([]);
        setMore(null);
      });
  };

  /** The next page of older conversations. This list grows with every question. */
  const loadMore = async () => {
    if (!more || fetching) return;
    setFetching(true);
    try {
      const { api } = await import("@/api");
      const page = await api.chats(projectKey, PAGE, more);
      setChats((current) => {
        const had = current ?? [];
        const seen = new Set(had.map((c) => c.id));
        return [...had, ...page.chats.filter((c) => !seen.has(c.id))];
      });
      setMore(page.next_before);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    setOpenId(null);
    setMessages([]);
    if (!projectKey) return;
    setChats(null);
    void refresh();
    // `refresh` closes over `projectKey`, which is the only thing it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, asking]);

  /*
   * Fetch the next page when the end of the list is reached.
   *
   * The observer is rebuilt whenever the cursor changes, because the callback
   * closes over it — a stale one would ask for the same page forever.
   */
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // `loadMore` is recreated every render; `more` is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more]);

  const open = async (id: string) => {
    setOpenId(id);
    setError(null);
    setOlder(null);
    const { api } = await import("@/api");
    const chat = await api.chat(id).catch(() => null);
    setMessages(chat?.messages ?? []);
    setOlder(chat?.next_before ?? null);
  };

  /**
   * The turns before the ones on screen.
   *
   * Scroll position is captured and restored around the prepend. Without it the
   * browser keeps the same `scrollTop` while the content above grows, which
   * throws the reader up the page to a message they were not looking at.
   */
  const loadOlder = async () => {
    if (!openId || !older || loadingOlder) return;
    setLoadingOlder(true);
    const box = transcript.current;
    const before = box ? box.scrollHeight - box.scrollTop : 0;
    try {
      const { api } = await import("@/api");
      const page = await api.chat(openId, older);
      setMessages((current) => {
        const seen = new Set(current.map((m) => m.id));
        return [...page.messages.filter((m) => !seen.has(m.id)), ...current];
      });
      setOlder(page.next_before ?? null);
      requestAnimationFrame(() => {
        if (box) box.scrollTop = box.scrollHeight - before;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const startNew = () => {
    setOpenId(null);
    setMessages([]);
    setError(null);
    setOlder(null);
  };

  /* The same trick as the chat list, at the other end: reaching the top of a
     transcript fetches the turns before it. */
  useEffect(() => {
    const target = top.current;
    if (!target || !older) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
      },
      { root: transcript.current, rootMargin: "80px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [older, openId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const asked = question.trim();
    if (!asked || asking) return;

    // The question appears immediately. A local model takes its time, and a
    // composer that clears with nothing to show for it reads as a lost message.
    const pending: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: asked,
      sources: [],
      grounded: true,
      model: "",
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, pending]);
    setQuestion("");
    setAsking(true);
    setError(null);

    try {
      const { api } = await import("@/api");
      const result = await api.askInChat(projectKey, asked, openId ?? undefined);
      setMessages((current) => [...current, result.message]);
      setOpenId(result.chat_id);
      void refresh();
    } catch (err) {
      // Put the question back in the box: retyping it is the one thing nobody
      // should have to do.
      setMessages((current) => current.filter((m) => m.id !== pending.id));
      setQuestion(asked);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };

  /*
   * Deleting asks first.
   *
   * A chat is the only thing in drymem that is gone for good — a memory can be
   * unshared, a skill deprecated and its versions kept, but the messages
   * cascade. The bin icon sits a few pixels from the row you click to open one.
   */
  const remove = async (id: string) => {
    const { api } = await import("@/api");
    await api.deleteChat(id).catch(() => {});
    if (id === openId) startNew();
    setConfirm(null);
    void refresh();
  };

  return (
    <>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* ---- the conversations so far ------------------------------------ */}
      <Card className="min-w-0 overflow-hidden p-0 lg:h-[42rem]">
        <CardHeader className="flex-row items-center justify-between gap-2 border-b p-3">
          <CardTitle className="text-sm">Chats</CardTitle>
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus data-icon="inline-start" /> New
          </Button>
        </CardHeader>
        <CardContent className="min-w-0 overflow-y-auto p-0">
          {chats === null ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : chats.length === 0 ? (
            <p className="text-muted-foreground p-4 text-xs">
              Nothing yet. Ask something and it is kept here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {chats.map((chat) => (
                <li
                  key={chat.id}
                  className={`hover:bg-muted/40 flex items-center gap-1 border-t px-2 py-2 first:border-t-0 ${
                    chat.id === openId ? "bg-muted/60" : ""
                  }`}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => open(chat.id)}>
                    <span className="block truncate text-xs font-medium">{chat.title}</span>
                    <span className="text-muted-foreground block truncate text-[11px]">
                      {relative(chat.updated_at)}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${chat.title}`}
                    onClick={() => setConfirm(chat)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {/*
            The sentinel. A chat list is scrolled, not navigated — nobody goes
            to "page 3 of my conversations" — so the next page arrives when the
            bottom comes into view rather than on a button. It still renders
            when there is more, so a browser without IntersectionObserver shows
            a plain line instead of silently stopping.
          */}
          {more && (
            <div ref={sentinel} className="text-muted-foreground p-3 text-center text-xs">
              {fetching ? "Loading…" : "Older chats"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- the conversation -------------------------------------------- */}
      <Card className="flex min-w-0 flex-col overflow-hidden p-0 lg:h-[42rem]">
        <CardContent ref={transcript} className="min-w-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <Blank icon={Sparkles} title="Ask this project">
              Answered only from what your team wrote down, with a citation on every claim. Try
              “who changed the payment component last, and why?”
            </Blank>
          ) : (
            <div className="flex flex-col gap-4">
              {older && (
                <div ref={top} className="text-muted-foreground text-center text-xs">
                  {loadingOlder ? "Loading earlier turns…" : "Earlier in this conversation"}
                </div>
              )}
              {messages.map((message) => (
                <Turn key={message.id} message={message} />
              ))}
              {asking && (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Spinner className="size-4" /> Reading the memories about that. A local model
                  takes a moment.
                </p>
              )}
              <div ref={bottom} />
            </div>
          )}
        </CardContent>

        <div className="border-border border-t p-3">
          {error && <p className="text-destructive mb-2 text-sm">{error}</p>}
          <form className="flex items-center gap-2" onSubmit={send}>
            <div className="relative min-w-0 flex-1">
              <MessageSquare className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                className="pl-8"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={openId ? "Ask a follow-up" : "Ask about this project's history"}
                aria-label="Ask a question"
                disabled={asking}
              />
            </div>
            <Button type="submit" disabled={asking || question.trim().length < 3}>
              <Send data-icon="inline-start" /> {asking ? "Thinking…" : "Ask"}
            </Button>
          </form>
        </div>
      </Card>
    </div>

    <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate">Delete “{confirm?.title}”?</DialogTitle>
          <DialogDescription>
            The whole conversation goes with it, and this cannot be undone. The memories it
            cited are untouched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep it</Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => confirm && remove(confirm.id)}>
            <Trash2 data-icon="inline-start" /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
