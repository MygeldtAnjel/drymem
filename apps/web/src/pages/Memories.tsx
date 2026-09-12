/**
 * Memories: the list, and one memory open.
 *
 * The list is filterable by kind and by whether it is shared, because the
 * question people actually arrive with is "what did we decide about X", not
 * "show me everything". Search is separate and deliberately labelled: it
 * searches *facts* drawn from memories, not the memories themselves, and
 * conflating the two would make the results look broken.
 */

import { useMemo, useState } from "react";
import {
  Ban,
  NotebookPen,
  Search as SearchIcon,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";

import { Blank, RatingChip, RowsSkeleton, ScopeChip, TypeChip } from "@/components/Bits";
import { Crumbs } from "@/components/Crumbs";
import { Markdown } from "@/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Episode, Fact } from "@/api";
import { MEMORY_TYPES, split } from "@/memory";
import { firstLine, relative, stamp } from "@/format";
import { go } from "@/router";

export function MemoriesPage({
  episodes,
  loading,
  facts,
  searching,
  query,
  onQuery,
  onSearch,
  onClearSearch,
}: {
  episodes: Episode[];
  loading: boolean;
  facts: Fact[] | null;
  searching: boolean;
  query: string;
  onQuery: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
}) {
  const [type, setType] = useState("all");
  const [scope, setScope] = useState("all");

  const shown = useMemo(
    () =>
      episodes.filter(
        (e) => (type === "all" || e.type === type) && (scope === "all" || e.scope === scope),
      ),
    [episodes, type, scope],
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of episodes) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }, [episodes]);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search facts — one or two short words, like “auth”"
            aria-label="Search the knowledge graph"
            spellCheck={false}
          />
        </div>
        <Button type="submit" disabled={!query.trim() || searching}>
          {searching ? "Searching…" : "Search"}
        </Button>
        {facts && (
          <Button type="button" variant="ghost" onClick={onClearSearch}>
            Clear
          </Button>
        )}
      </form>

      {facts ? (
        <FactResults facts={facts} query={query} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={type} onValueChange={setType}>
              <TabsList>
                <TabsTrigger value="all">All {episodes.length}</TabsTrigger>
                {Object.keys(MEMORY_TYPES)
                  .filter((t) => counts[t])
                  .map((t) => (
                    <TabsTrigger key={t} value={t} className="capitalize">
                      {t} {counts[t]}
                    </TabsTrigger>
                  ))}
              </TabsList>
            </Tabs>
            <Tabs value={scope} onValueChange={setScope} className="ml-auto">
              <TabsList>
                <TabsTrigger value="all">Everything</TabsTrigger>
                <TabsTrigger value="team">Shared</TabsTrigger>
                <TabsTrigger value="private">Private</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Card className="overflow-hidden p-0">
            {loading ? (
              <RowsSkeleton rows={6} />
            ) : shown.length === 0 ? (
              <Blank icon={NotebookPen} title={episodes.length === 0 ? "No memories yet" : "Nothing matches"}>
                {episodes.length === 0
                  ? "A memory appears the moment an agent calls mem_finalize_session in this project."
                  : "No memory of this kind. Try another filter."}
              </Blank>
            ) : (
              <ul className="flex flex-col">
                {shown.map((episode) => (
                  <li key={episode.uuid} className="border-t first:border-t-0">
                    <button
                      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      onClick={() => go("memories", episode.uuid)}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <TypeChip type={episode.type} />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {episode.title || episode.name}
                        </span>
                        <ScopeChip scope={episode.scope} />
                        <RatingChip rating={episode.rating} />
                      </span>
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {firstLine(episode.content, 180)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {episode.author ?? "unknown"} · {relative(episode.created_at)}
                        {episode.topic_key && (
                          <span className="font-mono"> · {episode.topic_key}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function FactResults({ facts, query }: { facts: Fact[]; query: string }) {
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="text-sm">
          {facts.length} {facts.length === 1 ? "fact" : "facts"} about “{query}”
        </CardTitle>
        <CardDescription>
          These are facts the graph drew out of your memories, not the memories themselves.
        </CardDescription>
      </CardHeader>
      {facts.length === 0 ? (
        <Blank icon={SearchIcon} title="Nothing found">
          Shorter keywords work better — “auth”, not “authentication setup”.
        </Blank>
      ) : (
        <ul className="flex flex-col">
          {facts.map((fact, i) => (
            <li key={`${fact.name}-${i}`} className="flex flex-col gap-1.5 border-t px-4 py-3">
              <p className="text-sm">{fact.fact}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{fact.name}</span>
                <span>· {relative(fact.created_at)}</span>
                {fact.superseded && (
                  <Badge variant="outline" className="text-destructive">
                    <Ban /> Superseded
                  </Badge>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One memory, with its facts up top and its body in labelled sections. */
export function MemoryDetail({
  episode,
  projectKey,
  onRate,
  onPromote,
  onDelete,
  busy,
}: {
  episode: Episode;
  projectKey: string;
  onRate: (rating: 1 | -1) => void;
  onPromote: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { lead, sections } = split(episode.content);
  const title = episode.title || episode.name;

  // The body's first heading is what became the title; printing it again puts
  // the same sentence on the page twice.
  const same = sections.length > 0 && sections[0]!.heading.trim() === title.trim();
  const body = same ? [{ ...sections[0]!, heading: "" }, ...sections.slice(1)] : sections;

  const facts: Array<[string, React.ReactNode]> = [
    ["Kind", <TypeChip type={episode.type} />],
    ["Author", episode.author ?? "unknown"],
    ["Saved", stamp(episode.created_at)],
    ["Project", <span className="font-mono text-xs">{projectKey}</span>],
  ];
  if (episode.topic_key) {
    facts.push(["Topic", <span className="font-mono text-xs">{episode.topic_key}</span>]);
  }
  if (episode.session_id) {
    facts.push([
      "Session",
      <button
        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
        onClick={() => go("sessions", episode.session_id)}
      >
        {episode.session_id}
      </button>,
    ]);
  }
  facts.push([
    "Visibility",
    episode.scope === "team"
      ? `Shared${episode.promoted_at ? ` · ${relative(episode.promoted_at)}` : ""}`
      : "Private to you",
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Crumbs
        trail={[
          { label: "Memories", page: "memories" },
          ...(episode.author ? [{ label: episode.author.split("@")[0]!, page: "memories" }] : []),
          { label: episode.title || "Memory" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <TypeChip type={episode.type} />
              <ScopeChip scope={episode.scope} />
              <RatingChip rating={episode.rating} />
            </div>
            <CardTitle className="text-lg leading-snug">{title}</CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-6">
            {lead && <Markdown source={lead} />}
            {body.map((section, i) => (
              <section key={`${section.heading}-${i}`} className="flex flex-col gap-2">
                {section.heading &&
                  (section.canonical ? (
                    <h2 className="border-t pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {section.heading}
                    </h2>
                  ) : (
                    <h2 className="text-base font-semibold">{section.heading}</h2>
                  ))}
                <Markdown source={section.body} />
              </section>
            ))}
            {!lead && sections.length === 0 && (
              <p className="text-sm text-muted-foreground">This memory is empty.</p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {facts.map(([term, value]) => (
                <div key={term} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">{term}</span>
                  <span className="break-words text-sm">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Was this useful?</CardTitle>
              <CardDescription>
                Ratings are how drymem learns which memories are worth surfacing.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant={episode.rating === 1 ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => onRate(1)}
                  disabled={busy}
                >
                  <ThumbsUp data-icon="inline-start" /> Useful
                </Button>
                <Button
                  variant={episode.rating === -1 ? "secondary" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => onRate(-1)}
                  disabled={busy}
                >
                  <ThumbsDown data-icon="inline-start" /> No
                </Button>
              </div>
              <Separator />
              {episode.scope === "team" ? (
                <p className="text-xs text-muted-foreground">
                  Already shared with everyone on this project.
                </p>
              ) : (
                <Button variant="outline" size="sm" onClick={onPromote} disabled={busy}>
                  <Share2 data-icon="inline-start" /> Share with the team
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
                <Trash2 data-icon="inline-start" /> Delete
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
