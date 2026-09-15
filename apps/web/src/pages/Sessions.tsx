/**
 * Sessions: the agent runs that produced the memories.
 *
 * Memories written before sessions were recorded are grouped by author and day
 * and say so. Inventing an id for them would make a guess look like a fact,
 * and a reader would have no way to tell the two apart.
 *
 * A row opens. The table used to be five columns and nowhere to click, which
 * is a fair thing to complain about: the only question anybody brings to it is
 * "what came out of that run?", and it could not answer.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, Boxes, ChevronRight, Info, SearchX } from "lucide-react";

import { Blank, PersonChip, RowsSkeleton, ScopeChip, TypeChip } from "@/components/Bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentSession as Session, SessionDetail } from "@/api";
import { clock, count, relative, when } from "@/format";
import { go } from "@/router";

export function sessionLabel(session: Session): string {
  return session.synthetic
    ? `${when(session.ended_at)} · grouped by day`
    : session.session_id;
}

/** The name when the org knows one; an email is not a person's name. */
function who(session: Session): string {
  return session.author_name || session.author;
}

function SyntheticNote() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="text-muted-foreground size-3.5 shrink-0" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        These memories were saved before drymem recorded sessions, so they are
        grouped by author and day rather than by a real run.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A sitting, as a card.
 *
 * This was a five-column table, and a table is for comparing rows on the same
 * axis — which nobody does here. What a person wants off this screen is "what
 * happened in that run", and the answer is the titles, which the table gave a
 * single truncated line at the smallest size on the page. The card leads with
 * them.
 */
function SessionCard({ session }: { session: Session }) {
  return (
    <li className="min-w-0">
      {/* `h-full` is what makes two cards in a row the same height: the grid
          stretches the `li`, but the button inside it only grew to its own
          content, so a one-title card sat short beside a three-title one. */}
      <button
        className="border-border bg-card hover:border-input hover:bg-muted/30 group flex h-full w-full min-w-0 flex-col gap-2.5 rounded-lg border p-4 text-left transition-colors"
        onClick={() => go("sessions", session.session_id)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Boxes className="text-muted-foreground size-4 shrink-0" />
          <span className={"min-w-0 truncate " + (session.synthetic ? "text-sm" : "font-mono text-xs")}>
            {sessionLabel(session)}
          </span>
          {session.synthetic && <SyntheticNote />}
          <ChevronRight className="text-muted-foreground ml-auto size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>

        {/* What actually happened, which is the only reason to open it. */}
        {session.titles.length > 0 && (
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            {session.titles.slice(0, 3).map((title) => (
              <span key={title} className="text-foreground min-w-0 truncate text-sm">
                {title}
              </span>
            ))}
            {session.memory_count > 3 && (
              <span className="text-muted-foreground text-xs">
                and {session.memory_count - 3} more
              </span>
            )}
          </span>
        )}

        <span className="text-muted-foreground mt-auto flex min-w-0 w-full flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2.5 text-xs">
          <PersonChip author={session.author} name={session.author_name} />
          <span aria-hidden>·</span>
          <span>{count(session.memory_count, "memory", "memories")}</span>
          {session.shared > 0 && (
            <>
              <span aria-hidden>·</span>
              <Badge variant="outline" className="text-success">
                {session.shared} shared
              </Badge>
            </>
          )}
          <span
            className="ml-auto"
            title={`${when(session.started_at)} ${clock(session.started_at)}`}
          >
            {relative(session.ended_at)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function SessionsPage({
  sessions,
  loading,
  hasMore,
  fetchingMore,
  onMore,
}: {
  sessions: Session[];
  loading: boolean;
  hasMore: boolean;
  fetchingMore: boolean;
  onMore: () => void;
}) {
  if (loading) {
    return (
      <Card className="p-0">
        <RowsSkeleton rows={5} />
      </Card>
    );
  }

  if (sessions.length === 0) {
    return (
      <Blank icon={Boxes} title="No sessions yet">
        A session appears the first time an agent saves a memory in this project.
      </Blank>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ul className="grid min-w-0 items-stretch gap-3 lg:grid-cols-2">
        {sessions.map((session) => (
          <SessionCard key={session.session_id} session={session} />
        ))}
      </ul>

      <div className="flex items-center justify-center gap-3">
        <p className="text-muted-foreground text-xs">
          {count(sessions.length, "session")}
          {hasMore ? " so far" : ""}
        </p>
        {hasMore && (
          <Button variant="outline" size="sm" disabled={fetchingMore} onClick={onMore}>
            {fetchingMore ? <Spinner className="size-3.5" /> : null} Load more
          </Button>
        )}
      </div>
    </div>
  );
}

/** One run, and what came out of it. */
export function SessionPage({
  projectKey,
  id,
}: {
  projectKey: string;
  id: string;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!projectKey || !id) return;
    let live = true;
    setDetail(null);
    setMissing(false);
    void (async () => {
      const { api } = await import("@/api");
      try {
        const found = await api.session(projectKey, id);
        if (live) setDetail(found);
      } catch {
        if (live) setMissing(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [projectKey, id]);

  if (missing) {
    return (
      <Blank icon={SearchX} title="That session is not here">
        It may belong to a different project, or to a teammate who kept it
        private.
      </Blank>
    );
  }

  if (!detail) {
    return (
      <Card className="p-0">
        <RowsSkeleton rows={4} />
      </Card>
    );
  }

  const { session, memories } = detail;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => go("sessions")}
        >
          <ArrowLeft data-icon="inline-start" /> All sessions
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            className={
              "min-w-0 truncate " +
              (session.synthetic
                ? "text-lg font-semibold"
                : "font-mono text-sm")
            }
          >
            {sessionLabel(session)}
          </h2>
          {session.synthetic && <SyntheticNote />}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {who(session)} · {count(session.memory_count, "memory", "memories")} ·{" "}
          {session.shared > 0 ? `${session.shared} shared` : "none shared"} ·{" "}
          <span
            title={`${when(session.started_at)} ${clock(session.started_at)}`}
          >
            {relative(session.ended_at)}
          </span>
        </p>
      </Card>

      {memories.length === 0 ? (
        <Blank icon={Boxes} title="Nothing to show">
          This run produced no memories you can read.
        </Blank>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="flex flex-col">
            {memories.map((memory) => (
              <li key={memory.uuid} className="border-t first:border-t-0">
                <button
                  className="hover:bg-muted/40 group flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors"
                  onClick={() => go("memories", memory.uuid)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {memory.title}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {memory.topic_key || "No topic"} ·{" "}
                      {relative(memory.created_at)}
                    </p>
                  </div>
                  <TypeChip type={memory.type} />
                  <ScopeChip scope={memory.scope} />
                  <ChevronRight className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
