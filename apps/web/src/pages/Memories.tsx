/**
 * Memories: the list, and one memory open.
 *
 * The list is filterable by kind and by whether it is shared, because the
 * question people actually arrive with is "what did we decide about X", not
 * "show me everything". Search is separate and deliberately labelled: it
 * searches memories, with the facts the graph drew out of them underneath, and
 * conflating the two would make the results look broken.
 */

import { useEffect, useMemo, useState } from "react";
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
import { Pager } from "@/components/Pager";
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
import type { Episode, Fact, TreeArea, TreeDecision } from "@/api";
import { MEMORY_TYPES, TYPE_FILL, split } from "@/memory";
import { firstLine, person, relative, stamp } from "@/format";
import { go } from "@/router";

export function MemoriesPage({
  episodes,
  loading,
  facts,
  hits,
  searching,
  query,
  onQuery,
  onSearch,
  onClearSearch,
  page,
  total,
  perPage,
  busy,
  onPage,
}: {
  episodes: Episode[];
  loading: boolean;
  facts: Fact[] | null;
  hits: Episode[] | null;
  searching: boolean;
  query: string;
  onQuery: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  page: number;
  total: number;
  perPage: number;
  busy: boolean;
  onPage: (page: number) => void;
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
            placeholder="Search this project — one or two short words, like “auth”"
            aria-label="Search the knowledge graph"
            spellCheck={false}
          />
        </div>
        <Button type="submit" disabled={!query.trim() || searching}>
          {searching ? "Searching…" : "Search"}
        </Button>
        {hits && (
          <Button type="button" variant="ghost" onClick={onClearSearch}>
            Clear
          </Button>
        )}
      </form>

      {hits ? (
        <SearchResults hits={hits} facts={facts ?? []} query={query} />
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
              <>
                <ul className="flex flex-col">
                  {shown.map((episode) => (
                    <MemoryRow key={episode.uuid} episode={episode} />
                  ))}
                </ul>
                {/* Numbered, not "load more": this is an archive somebody
                    comes back to, and page 4 should still be page 4 tomorrow.
                    The filters above are client-side and so apply to the page
                    on screen, which is why the count here is the true total. */}
                <Pager
                  page={page}
                  total={total}
                  perPage={perPage}
                  busy={busy}
                  onPage={onPage}
                />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** One memory in a list. The same row whether you browsed to it or searched. */
function MemoryRow({ episode }: { episode: Episode }) {
  return (
    <li className="border-t first:border-t-0">
      <button
        className="hover:bg-muted/40 flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors"
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
        <span className="text-muted-foreground line-clamp-2 text-sm">
          {firstLine(episode.content, 180)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {person(episode.author, episode.author_name)} · {relative(episode.created_at)}
          {episode.topic_key && <span className="font-mono"> · {episode.topic_key}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * What a search found.
 *
 * Memories first, because that is what somebody looking for "the lockfile
 * decision" wants — something they can open and read. The facts the graph drew
 * out of them sit underneath, collapsed: useful as corroboration, useless on
 * their own, since a fact has nothing behind it to click.
 */
function SearchResults({
  hits,
  facts,
  query,
}: {
  hits: Episode[];
  facts: Fact[];
  query: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-sm">
            {hits.length} {hits.length === 1 ? "memory" : "memories"} about “{query}”
          </CardTitle>
          <CardDescription>Best match first. Click one to read it.</CardDescription>
        </CardHeader>
        {hits.length === 0 ? (
          <Blank icon={SearchIcon} title="Nothing found">
            Shorter keywords work better — “auth”, not “authentication setup”.
          </Blank>
        ) : (
          <ul className="flex flex-col">
            {hits.map((episode) => (
              <MemoryRow key={episode.uuid} episode={episode} />
            ))}
          </ul>
        )}
      </Card>

      {facts.length > 0 && (
        <Card className="overflow-hidden p-0">
          <details>
            <summary className="hover:bg-muted/40 cursor-pointer px-4 py-3 text-sm">
              <span className="font-medium">
                {facts.length} related {facts.length === 1 ? "fact" : "facts"}
              </span>
              <span className="text-muted-foreground">
                {" "}
                — what the graph concluded from these memories
              </span>
            </summary>
            <ul className="flex flex-col">
              {facts.map((fact, i) => (
                <li key={`${fact.name}-${i}`} className="flex flex-col gap-1.5 border-t px-4 py-3">
                  <p className="text-sm">{fact.fact}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
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
          </details>
        </Card>
      )}
    </div>
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
    [
      "Author",
      // The name reads; the address is still the identifier, so it stays on hover.
      <span title={episode.author ?? undefined}>{person(episode.author, episode.author_name)}</span>,
    ],
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

          <Related episode={episode} projectKey={projectKey} />
        </div>
      </div>
    </div>
  );
}

/**
 * The other memories about the same part of the codebase.
 *
 * Built from the decision tree, which already knows which areas a memory
 * belongs to — no new endpoint, and the same answer the tree gives, so the two
 * screens never disagree about what "related" means.
 *
 * Absent entirely when this memory names no file: there is no relationship to
 * claim, and a card saying "none" is a card that earns nothing.
 */
/**
 * How many related memories are worth showing at all.
 *
 * It used to be five *per area*, and a memory touching both `apps/server` and
 * `apps/api` is in two areas — so a sidebar card quietly became eleven links
 * and outgrew the memory it was meant to support.
 */
const RELATED_MAX = 5;

function Related({ episode, projectKey }: { episode: Episode; projectKey: string }) {
  const [areas, setAreas] = useState<{ area: string; decisions: TreeDecision[] }[] | null>(null);
  const [more, setMore] = useState(0);

  useEffect(() => {
    let live = true;
    import("@/api")
      .then(({ api }) => api.tree(projectKey))
      .then((tree) => {
        if (!live) return;
        const found: { area: string; decisions: TreeDecision[] }[] = [];
        const walk = (node: TreeArea) => {
          // A leaf area holds the decisions; the branches above only group.
          if (node.decisions.some((d) => d.id === episode.uuid)) {
            const others = node.decisions.filter((d) => d.id !== episode.uuid);
            if (others.length > 0) found.push({ area: node.id, decisions: others });
          }
          node.children.forEach(walk);
        };
        walk(tree.root);

        // Smallest area first: sharing `apps/server` with forty memories says
        // almost nothing, sharing one file with two says a lot.
        found.sort((a, b) => a.decisions.length - b.decisions.length);

        const total = found.reduce((n, a) => n + a.decisions.length, 0);
        const kept: { area: string; decisions: TreeDecision[] }[] = [];
        let room = RELATED_MAX;
        for (const area of found) {
          if (room <= 0) break;
          kept.push({ area: area.area, decisions: area.decisions.slice(0, room) });
          room -= Math.min(room, area.decisions.length);
        }
        setAreas(kept);
        setMore(total - Math.min(total, RELATED_MAX));
      })
      .catch(() => live && setAreas([]));
    return () => {
      live = false;
    };
  }, [projectKey, episode.uuid]);

  if (!areas || areas.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Related</CardTitle>
        <CardDescription>Other memories about the same part of the codebase.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {areas.map(({ area, decisions }) => (
          <div key={area} className="min-w-0">
            <p className="text-muted-foreground mb-1.5 truncate font-mono text-xs">{area}</p>
            <ul className="flex flex-col gap-1.5">
              {decisions.map((d) => (
                <li key={d.id}>
                  <button
                    className="hover:text-foreground w-full text-left"
                    onClick={() => go("memories", d.id)}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${TYPE_FILL[d.type] ?? TYPE_FILL.note}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-xs ${d.superseded_by ? "line-through opacity-60" : ""}`}
                      >
                        {d.title}
                      </span>
                    </span>
                    <span className="text-muted-foreground block truncate pl-3 text-[11px]">
                      {person(d.author, d.author_name)} · {relative(d.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {more > 0 && (
          <button
            className="text-muted-foreground hover:text-foreground text-left text-xs"
            onClick={() => go("graph")}
          >
            {more} more in the decision tree →
          </button>
        )}
      </CardContent>
    </Card>
  );
}
