/**
 * The first screen: what this project knows, and whether anything is wrong.
 *
 * It answers three questions in one glance — how much is here, how much of it
 * the team can actually see, and is the thing running. Nothing on it is
 * decorative: every number is a link to the screen that explains it.
 */

import { Activity, Boxes, NotebookPen, Sparkles, Users } from "lucide-react";

import { Blank, TypeChip } from "@/components/Bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Episode, Health, Overview as Stats } from "@/api";
import { MEMORY_TYPES, TYPE_FILL } from "@/memory";
import { relative } from "@/format";
import { go } from "@/router";

function Tile({
  label,
  value,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Users;
  onClick?: () => void;
}) {
  return (
    <Card
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={onClick ? "cursor-pointer transition-colors hover:bg-muted/40" : undefined}
    >
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          {label}
          <Icon className="size-4 shrink-0" />
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

/** The type mix, as one bar. A pie for six values would be harder to read. */
function TypeMix({ byType, total }: { byType: Record<string, number>; total: number }) {
  const order = Object.keys(MEMORY_TYPES).filter((t) => (byType[t] ?? 0) > 0);
  if (total === 0 || order.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {order.map((type) => (
          <span
            key={type}
            className={TYPE_FILL[type] ?? TYPE_FILL.note}
            style={{ width: `${((byType[type] ?? 0) / total) * 100}%` }}
            // The bar is a summary of the list below it, which carries the
            // same numbers in words — so it needs no label of its own.
            aria-hidden
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {order.map((type) => (
          <span key={type} className="flex items-center gap-1.5 text-xs">
            <TypeChip type={type} />
            <span className="tabular-nums text-muted-foreground">{byType[type]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function OverviewPage({
  stats,
  health,
  recent,
  loading,
}: {
  stats: Stats | null;
  health: Health | null;
  recent: Episode[];
  loading: boolean;
}) {
  if (loading && !stats) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <Blank icon={NotebookPen} title="Nothing here yet">
        This project has no memories. One appears the moment an agent saves its first.
      </Blank>
    );
  }

  const rated = stats.positive + stats.negative;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Memories"
          value={stats.memories}
          hint={`${stats.shared} shared with the team`}
          icon={NotebookPen}
          onClick={() => go("memories")}
        />
        <Tile
          label="Sessions"
          value={stats.sessions}
          hint="Recorded agent runs"
          icon={Boxes}
          onClick={() => go("sessions")}
        />
        <Tile
          label="Skills"
          value={stats.skills}
          hint="Published to this project"
          icon={Sparkles}
          onClick={() => go("skills")}
        />
        <Tile
          label="Members"
          value={stats.members}
          hint="Can read what is shared"
          icon={Users}
          onClick={() => go("members")}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>What this project remembers</CardTitle>
            <CardDescription>
              Every memory has a kind. The mix tells you what the team keeps writing down.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TypeMix byType={stats.by_type} total={stats.memories} />
            {stats.memories === 0 && (
              <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Service</CardTitle>
            <CardDescription>Where drymem stores and reads memory.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {health ? (
              <>
                <Row label="Index (Postgres)" ok={health.postgres} />
                <Row label="Graph (Neo4j)" ok={health.neo4j} />
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Extraction</span>
                  <Badge variant="outline" className="font-mono">
                    {health.extractor}
                  </Badge>
                </div>
              </>
            ) : (
              <Skeleton className="h-20" />
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Rated useful</span>
              <span className="tabular-nums">
                {rated === 0
                  ? "Not rated yet"
                  : `${Math.round((stats.positive / rated) * 100)}% of ${rated}`}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest memories</CardTitle>
          <CardDescription>The most recent things this project learned.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => go("memories")}>
              View all
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <Blank icon={Activity} title="No memories yet">
              Once an agent calls <code className="font-mono">mem_finalize_session</code>, it
              shows up here.
            </Blank>
          ) : (
            <ul className="flex flex-col">
              {recent.slice(0, 6).map((episode) => (
                <li key={episode.uuid} className="border-t first:border-t-0">
                  <button
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40"
                    onClick={() => go("memories", episode.uuid)}
                  >
                    <TypeChip type={episode.type} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {episode.title || episode.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {episode.author ?? "unknown"} · {relative(episode.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="outline" className={ok ? "text-success" : "text-destructive"}>
        <span
          className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-destructive"}`}
          aria-hidden
        />
        {ok ? "Connected" : "Unreachable"}
      </Badge>
    </div>
  );
}
