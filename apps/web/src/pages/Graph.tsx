/**
 * Decisions: a question box, and the tree of what was decided where.
 *
 * This is the screen that makes the product legible: what the team decided,
 * who decided it, and what it touched.
 *
 * **Ask** is on top because it is what a lead actually arrives with: *"who
 * changed the payment component last?"*. Every claim in the answer carries a
 * citation, and the cited memories are listed under it, because an answer you
 * cannot check is worse than no answer.
 *
 * **The tree** is underneath: the parts of the codebase, and the decisions that
 * touched each one. Clicking a decision opens it in a panel beside the tree
 * rather than navigating away — people want to read the thing before deciding
 * whether to leave the page they are exploring.
 *
 * There was a second view here, a canvas of every memory against every subject
 * the extractor found. It drew 509 nouns for 20 memories and Miguel's verdict
 * was "useless". It is gone rather than demoted: a view nobody opens is still a
 * tab everybody reads past.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Search, Sparkles, X } from "lucide-react";

import { TypeChip } from "@/components/Bits";
import { Markdown } from "@/Markdown";
import { DecisionTreeCanvas } from "@/pages/DecisionTree";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AskResult, Tree, TreeDecision } from "@/api";
import { MEMORY_TYPES } from "@/memory";
import { relative } from "@/format";
import { go } from "@/router";

/**
 * One decision, beside the tree.
 *
 * Enough to answer "is this the one I meant" without leaving: the title, who
 * and when, the opening of the body, and the files that put it in this branch.
 * "Open" is there for when the answer is yes.
 */
function DecisionPanel({
  decision,
  onClose,
}: {
  decision: TreeDecision;
  onClose: () => void;
}) {
  return (
    // The same height as the tree beside it, so the "Open" button is on screen
    // rather than below the fold of a panel that grew past its neighbour.
    <aside className="border-border flex w-full shrink-0 flex-col border-t lg:h-[640px] lg:w-96 lg:border-t-0 lg:border-l">
      <div className="border-border flex items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <TypeChip type={decision.type} />
            {decision.superseded_by && (
              <Badge variant="outline" className="text-destructive">
                Replaced by a later memory
              </Badge>
            )}
          </div>
          <h3 className="text-sm leading-snug font-medium">{decision.title}</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {decision.author || "unknown"} · {relative(decision.created_at)}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {decision.gist ? (
          <Markdown source={decision.gist} />
        ) : (
          <p className="text-muted-foreground text-sm">No summary was written for this one.</p>
        )}

        {decision.paths.length > 0 && (
          <div className="mt-4">
            <p className="text-muted-foreground mb-1.5 text-xs font-medium">Files it names</p>
            <ul className="flex flex-col gap-1">
              {decision.paths.map((path) => (
                <li key={path} className="text-muted-foreground truncate font-mono text-xs">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-border border-t p-4">
        <Button className="w-full" onClick={() => go("memories", decision.id)}>
          Open this memory <ArrowUpRight data-icon="inline-end" />
        </Button>
      </div>
    </aside>
  );
}

export function GraphPage({ projectKey }: { projectKey: string }) {
  const [kind, setKind] = useState("all");
  const [tree, setTree] = useState<Tree | null>(null);
  // Clicking a decision opens it beside the tree rather than navigating away:
  // people want to read the thing, then decide whether to leave the page.
  const [picked, setPicked] = useState<TreeDecision | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setTreeLoading(true);
    import("@/api")
      .then(({ api }) => api.tree(projectKey, kind === "all" ? [] : [kind]))
      .then((built) => live && setTree(built))
      .catch(() => live && setTree(null))
      .finally(() => live && setTreeLoading(false));
    return () => {
      live = false;
    };
  }, [projectKey, kind]);

  // A filter change rebuilds the tree, so the open decision may no longer be
  // in it. Closing is honest; leaving it open beside a tree it is not in is not.
  useEffect(() => setPicked(null), [projectKey, kind]);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setAsking(true);
    setError(null);
    try {
      const { api } = await import("@/api");
      setResult(await api.ask(projectKey, trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary" /> Ask this project
          </CardTitle>
          <CardDescription>
            Answered only from what your team wrote down, with a citation on every claim. Try
            “who changed the payment component last, and why?”
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-wrap items-center gap-2" onSubmit={ask}>
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about this project's history"
                aria-label="Ask a question"
              />
            </div>
            <Button type="submit" disabled={asking || !question.trim()}>
              {asking ? "Thinking…" : "Ask"}
            </Button>
          </form>

          {asking && (
            <p className="text-sm text-muted-foreground">
              Reading the memories about that. A local model takes a moment.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && !asking && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm leading-relaxed">{result.answer}</p>
              {result.sources.length > 0 && (
                <ul className="flex flex-col gap-1 border-t pt-3">
                  {result.sources.map((source) => (
                    <li key={source.uuid}>
                      <button
                        className="flex w-full items-center gap-2 text-left text-xs hover:underline"
                        onClick={() => go("memories", source.uuid)}
                      >
                        <span className="font-mono text-muted-foreground">[{source.index}]</span>
                        <TypeChip type={source.type} />
                        <span className="min-w-0 flex-1 truncate">{source.title}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {source.author} · {relative(source.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                {result.grounded
                  ? `Written by ${result.model} from the memories above, and nothing else.`
                  : "No answer was produced — open the memories directly."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-wrap gap-3 border-b p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm">What was decided, and where</CardTitle>
              <CardDescription>
                Your codebase, and the decisions that touched each part. Newest first. Click a
                branch to open it, a decision to read it.
              </CardDescription>
            </div>
            <div className="min-w-0 overflow-x-auto">
              <Tabs value={kind} onValueChange={setKind}>
                <TabsList className="w-max">
                  <TabsTrigger value="all">All</TabsTrigger>
                  {Object.keys(MEMORY_TYPES).map((t) => (
                    <TabsTrigger key={t} value={t} className="capitalize">
                      {t}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
          {tree?.truncated && (
            <Badge variant="outline" className="text-muted-foreground w-fit">
              Showing the most recent slice of {tree.total_memories} memories
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {treeLoading && !tree ? (
            <Skeleton className="h-[40rem] rounded-none" />
          ) : (
            <div className="flex min-w-0 flex-col lg:flex-row">
              <div className="min-w-0 flex-1">
                <DecisionTreeCanvas
                  root={tree?.root ?? null}
                  unplaced={tree?.unplaced ?? 0}
                  selectedId={picked?.id ?? null}
                  onSelect={setPicked}
                />
              </div>
              {picked && (
                <DecisionPanel decision={picked} onClose={() => setPicked(null)} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
