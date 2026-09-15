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

import { Blank, RowsSkeleton, ScopeChip, TypeChip } from "@/components/Bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export function SessionsPage({
  sessions,
  loading,
}: {
  sessions: Session[];
  loading: boolean;
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
        A session appears the first time an agent saves a memory in this
        project.
      </Blank>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead>Who</TableHead>
            <TableHead className="text-right">Memories</TableHead>
            <TableHead className="text-right">Shared</TableHead>
            <TableHead className="text-right">When</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow
              key={session.session_id}
              tabIndex={0}
              role="link"
              aria-label={`Open ${sessionLabel(session)}`}
              className="hover:bg-muted/40 group cursor-pointer"
              onClick={() => go("sessions", session.session_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go("sessions", session.session_id);
                }
              }}
            >
              <TableCell className="max-w-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "truncate " +
                      (session.synthetic ? "" : "font-mono text-xs")
                    }
                  >
                    {sessionLabel(session)}
                  </span>
                  {session.synthetic && <SyntheticNote />}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {session.titles.join(" · ") || "No titles"}
                </p>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {who(session)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {session.memory_count}
              </TableCell>
              <TableCell className="text-right">
                {session.shared > 0 ? (
                  <Badge variant="outline" className="text-success">
                    {session.shared}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-right">
                <span
                  title={`${when(session.started_at)} ${clock(session.started_at)}`}
                >
                  {relative(session.ended_at)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <ChevronRight className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
        {count(sessions.length, "session")}
      </p>
    </Card>
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
