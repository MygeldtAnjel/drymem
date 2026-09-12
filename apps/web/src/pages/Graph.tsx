/**
 * The knowledge graph, and a question box over it.
 *
 * This is the screen that makes the product legible: what the team decided,
 * who decided it, and what it touched — drawn from data Graphiti has been
 * building since the first memory and that nobody had ever looked at.
 *
 * Two halves.
 *
 * **Ask** is on top because it is what a lead actually arrives with: *"who
 * changed the payment component last?"*. Every claim in the answer carries a
 * citation, and the cited memories are listed under it, because an answer you
 * cannot check is worse than no answer.
 *
 * **The canvas** is underneath. Memories are coloured by kind and entities are
 * plain; an edge between two entities is a fact, drawn dashed and struck
 * through when a later memory contradicted it. Layout is computed here rather
 * than on the server, so changing how it looks never means changing a query.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import dagre from "dagre";
import { Ban, Network, Search, Sparkles } from "lucide-react";

import "@xyflow/react/dist/style.css";

import { Blank, TypeChip } from "@/components/Bits";
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
import type { AskResult, Graph } from "@/api";
import { MEMORY_TYPES } from "@/memory";
import { relative } from "@/format";
import { go } from "@/router";

/** One hue per memory kind, matching the chips everywhere else. */
const KIND_COLOR: Record<string, string> = {
  decision: "#a98bf5",
  architecture: "#5b9cf5",
  bugfix: "#f0596b",
  discovery: "#f2a93b",
  convention: "#3fb27f",
  note: "#7d8794",
};

const NODE_W = 210;
const NODE_H = 40;

/**
 * Lay the graph out left to right.
 *
 * Dagre rather than a force simulation: this is a graph of *what mentions
 * what*, which is a hierarchy, and a force layout turns a hierarchy into a
 * hairball that moves every time you look at it.
 */
function layout(graph: Graph, showFacts: boolean): { nodes: Node[]; edges: Edge[] } {
  // Memory → subject is the structure; subject → subject is detail. Drawing
  // both by default put 77 crossing edges through the middle of a canvas that
  // is otherwise a clean bipartite graph, so facts are opt-in.
  const drawn = graph.edges.filter((e) => showFacts || e.kind === "mentions");

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 220, marginx: 24, marginy: 24 });

  for (const node of graph.nodes) g.setNode(node.id, { width: NODE_W, height: NODE_H });
  for (const edge of drawn) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((node) => {
    const placed = g.node(node.id);
    const memory = node.kind === "memory";
    const colour = memory ? (KIND_COLOR[node.type] ?? KIND_COLOR.note!) : "#333c48";
    return {
      id: node.id,
      position: { x: placed?.x ?? 0, y: placed?.y ?? 0 },
      data: { label: node.label, kind: node.kind },
      style: {
        width: NODE_W,
        // Memories are the thing you click through to, so they carry the hue
        // and the entities stay quiet. A canvas where everything is coloured
        // is a canvas where nothing is.
        background: memory ? `${colour}22` : "#171b21",
        border: `1px solid ${memory ? colour : "#333c48"}`,
        borderRadius: memory ? 8 : 999,
        color: "#e8eaed",
        fontSize: 12,
        padding: "7px 10px",
        textAlign: "left" as const,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap" as const,
        cursor: memory ? "pointer" : "default",
      },
    };
  });

  const edges: Edge[] = drawn.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.kind === "fact" ? edge.label.slice(0, 60) : undefined,
    animated: false,
    style: {
      // The mentions edges are the structure and were nearly invisible at
      // `border` grey; they need to read against the canvas, not blend into it.
      stroke: edge.superseded ? "#f0596b" : edge.kind === "fact" ? "#6b7688" : "#3b4450",
      strokeWidth: edge.kind === "fact" ? 1.4 : 1,
      // A contradicted fact is struck, not hidden: "we changed our mind" is the
      // most useful thing a decision graph can show.
      strokeDasharray: edge.superseded ? "4 3" : undefined,
    },
    labelStyle: { fill: "#98a1ad", fontSize: 9 },
    labelBgStyle: { fill: "#111419" },
  }));

  return { nodes, edges };
}

export function GraphPage({
  projectKey,
  loading,
  graph,
  onReload,
}: {
  projectKey: string;
  loading: boolean;
  graph: Graph | null;
  onReload: (kinds: string[], minMentions: number) => void;
}) {
  const [kind, setKind] = useState("all");
  /**
   * How much of the graph to draw.
   *
   * "Connected" keeps only the subjects two or more memories mention, which is
   * what makes the canvas a picture of how things relate rather than a list of
   * every noun anyone typed. Drawing all of them first produced 173 nodes and
   * 447 edges, which is the whole graph and a view of nothing.
   */
  // "Core" by default. A project's whole graph is taller than any screen, so
  // the first view is the sparse one that fits and reads; the other two are a
  // click away for someone who came to explore rather than to orient.
  const [density, setDensity] = useState("3");
  const [showFacts, setShowFacts] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onReload(kind === "all" ? [] : [kind], Number(density));
    // `onReload` is stable in the parent; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, density, projectKey]);

  const laid = useMemo(
    () => (graph ? layout(graph, showFacts) : { nodes: [], edges: [] }),
    [graph, showFacts],
  );

  const openNode: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.data?.kind === "memory") go("memories", node.id);
    },
    [],
  );

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

  const memories = graph?.nodes.filter((n) => n.kind === "memory").length ?? 0;
  const entities = graph?.nodes.filter((n) => n.kind === "entity").length ?? 0;

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
            <div>
              <CardTitle className="text-sm">The graph</CardTitle>
              <CardDescription>
                {graph
                  ? `${memories} memories and ${entities} subjects. Click a memory to read it.`
                  : "What this project knows, and how it connects."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={density} onValueChange={setDensity}>
                <TabsList>
                  <TabsTrigger value="3">Core</TabsTrigger>
                  <TabsTrigger value="2">Connected</TabsTrigger>
                  <TabsTrigger value="1">Everything</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs
                value={showFacts ? "facts" : "structure"}
                onValueChange={(v) => setShowFacts(v === "facts")}
              >
                <TabsList>
                  <TabsTrigger value="structure">Structure</TabsTrigger>
                  <TabsTrigger value="facts">With facts</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs value={kind} onValueChange={setKind}>
                <TabsList>
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
          {graph?.truncated && (
            <Badge variant="outline" className="w-fit text-muted-foreground">
              Showing the most recent slice of {graph.total_memories} memories
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading && !graph ? (
            <Skeleton className="h-[40rem] rounded-none" />
          ) : laid.nodes.length === 0 ? (
            <Blank icon={Network} title="Nothing to draw yet">
              The graph fills in as memories are saved. Each one adds the subjects it mentions
              and the facts drawn between them.
            </Blank>
          ) : (
            <div className="h-[40rem] w-full">
              <ReactFlow
                nodes={laid.nodes}
                edges={laid.edges}
                onNodeClick={openNode}
                fitView
                fitViewOptions={{ padding: 0.1, maxZoom: 0.9 }}
                minZoom={0.1}
                proOptions={{ hideAttribution: true }}
                colorMode="dark"
              >
                <Background color="#232932" gap={18} />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) =>
                    n.data?.kind === "memory" ? (KIND_COLOR.decision ?? "#a98bf5") : "#333c48"
                  }
                  maskColor="rgb(11 13 16 / 0.7)"
                  style={{ background: "#111419", border: "1px solid #232932" }}
                />
              </ReactFlow>
            </div>
          )}
        </CardContent>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-[#a98bf5] bg-[#a98bf522]" /> memory
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border border-[#333c48] bg-[#171b21]" /> subject
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-px w-4 bg-[#6b7688]" /> fact (shown under “With facts”)
          </span>
          <span className="flex items-center gap-1.5">
            <Ban className="size-3 text-destructive" /> superseded by a later memory
          </span>
        </div>
      </Card>
    </div>
  );
}
