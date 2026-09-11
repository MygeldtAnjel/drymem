/**
 * Sessions: the agent runs that produced the memories.
 *
 * Memories written before sessions were recorded are grouped by author and day
 * and say so. Inventing an id for them would make a guess look like a fact,
 * and a reader would have no way to tell the two apart.
 */

import { Boxes, Info } from "lucide-react";

import { Blank, RowsSkeleton } from "@/components/Bits";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Session } from "@/api";
import { clock, count, relative, when } from "@/format";

export function sessionLabel(session: Session): string {
  return session.synthetic ? `${when(session.ended_at)} · grouped by day` : session.session_id;
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
        A session appears the first time an agent saves a memory in this project.
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.session_id}>
              <TableCell className="max-w-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "truncate " + (session.synthetic ? "" : "font-mono text-xs")
                    }
                  >
                    {sessionLabel(session)}
                  </span>
                  {session.synthetic && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 shrink-0 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        These memories were saved before drymem recorded sessions, so they are
                        grouped by author and day rather than by a real run.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {session.titles.join(" · ") || "No titles"}
                </p>
              </TableCell>
              <TableCell className="text-muted-foreground">{session.author}</TableCell>
              <TableCell className="text-right tabular-nums">{session.memory_count}</TableCell>
              <TableCell className="text-right">
                {session.shared > 0 ? (
                  <Badge variant="outline" className="text-success">
                    {session.shared}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                <span title={`${when(session.started_at)} ${clock(session.started_at)}`}>
                  {relative(session.ended_at)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
        {count(sessions.length, "session")}
      </p>
    </Card>
  );
}
