/**
 * Decisions: the tree of what was decided where.
 *
 * This is the screen that makes the product legible: what the team decided,
 * who decided it, and what it touched — the parts of the codebase, and the
 * decisions that touched each one.
 *
 * Asking used to sit on top of this as a box and a single answer. It is its own
 * screen now, because the second question is always "and why?" and one box
 * cannot hold a conversation. Clicking a decision opens it in a panel beside the tree
 * rather than navigating away — people want to read the thing before deciding
 * whether to leave the page they are exploring.
 *
 * There was a second view here, a canvas of every memory against every subject
 * the extractor found. It drew 509 nouns for 20 memories and Miguel's verdict
 * was "useless". It is gone rather than demoted: a view nobody opens is still a
 * tab everybody reads past.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tree, TreeDecision } from "@/api";
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

  return (
    <div className="flex flex-col gap-4">
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
