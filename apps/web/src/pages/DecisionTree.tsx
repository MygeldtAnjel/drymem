/**
 * The decision tree.
 *
 * The canvas beside this draws every memory against every subject and produces
 * a hairball — 509 extracted nouns for 20 memories, nineteen per memory, and
 * they are things like `npm`. This draws a hierarchy instead: the parts of the
 * codebase, and what was decided about each one, newest first.
 *
 * Two things make it readable where the canvas was not.
 *
 * **One parent per node.** The branch comes from the files a memory names, not
 * from what a model extracted, so it is the same tree every time.
 *
 * **Collapsed until asked.** Only the top rank opens on load. A tree that
 * renders everything is the hairball again with straighter lines, and the whole
 * point is arriving at "who changed this last" in two clicks.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "dagre";
import { ChevronDown, ChevronRight, FolderTree } from "lucide-react";

import "@xyflow/react/dist/style.css";

import { Blank } from "@/components/Bits";
import type { TreeArea, TreeDecision } from "@/api";
import { pathTo } from "@/tree";
import { person, relative } from "@/format";
import { TYPE_FILL } from "@/memory";

/* Measured, not guessed: dagre needs real sizes or the ranks collide. */
const AREA_W = 190;
const AREA_H = 46;
const DECISION_W = 300;
const DECISION_H = 84;

type AreaData = {
  label: string;
  total: number;
  open: boolean;
  leaf: boolean;
  onToggle: () => void;
};

type DecisionData = {
  decision: TreeDecision;
  selected: boolean;
  onOpen: () => void;
};

function AreaNode({ data }: NodeProps) {
  const { label, total, open, leaf, onToggle } = data as unknown as AreaData;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ width: AREA_W, height: AREA_H }}
      className="border-border bg-card hover:border-input flex items-center gap-2 rounded-lg border px-3 text-left transition-colors"
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {leaf ? (
        <span className="size-4" />
      ) : open ? (
        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
      ) : (
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      )}
      <span className="truncate font-mono text-[13px] font-medium">{label}</span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">{total}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </button>
  );
}

function DecisionNode({ data }: NodeProps) {
  const { decision, selected, onOpen } = data as unknown as DecisionData;
  const dead = Boolean(decision.superseded_by);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ width: DECISION_W, height: DECISION_H }}
      className={
        "bg-card hover:border-input flex flex-col justify-center gap-1 rounded-lg border px-3 py-2 text-left transition-colors " +
        (selected ? "border-foreground ring-foreground/20 ring-2 " : "border-border ") +
        (dead ? "opacity-60" : "")
      }
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center gap-1.5">
        <span className={`size-1.5 shrink-0 rounded-full ${TYPE_FILL[decision.type] ?? TYPE_FILL.note}`} />
        <span className={`truncate text-[13px] font-medium ${dead ? "line-through" : ""}`}>
          {decision.title}
        </span>
      </div>
      {decision.gist && (
        <p className="text-muted-foreground line-clamp-1 text-xs">{decision.gist}</p>
      )}
      <p className="text-muted-foreground truncate text-[11px]">
        {person(decision.author, decision.author_name)} · {relative(decision.created_at)}
        {dead && " · replaced"}
      </p>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </button>
  );
}

const nodeTypes = { area: AreaNode, decision: DecisionNode };

/** Every area id down to `depth`, so the first render opens the top rank only. */
function openToDepth(area: TreeArea, depth: number, into: Set<string>, at = 0): Set<string> {
  if (at < depth) {
    into.add(area.id);
    for (const child of area.children) openToDepth(child, depth, into, at + 1);
  }
  return into;
}

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  /*
   * Left to right, not top down.
   *
   * Top-down spreads a generation sideways, and a generation here is "every
   * decision about apps/web" — twenty cards on one row, which `fitView` then
   * zooms to the size of a stamp. Growing rightwards stacks them in a column
   * instead, which is the shape a file tree has for the same reason.
   */
  g.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 56 });

  for (const node of nodes) {
    const isArea = node.type === "area";
    g.setNode(node.id, {
      width: isArea ? AREA_W : DECISION_W,
      height: isArea ? AREA_H : DECISION_H,
    });
  }
  for (const edge of edges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);

  return nodes.map((node) => {
    const placed = g.node(node.id);
    const isArea = node.type === "area";
    return {
      ...node,
      position: {
        x: placed.x - (isArea ? AREA_W : DECISION_W) / 2,
        y: placed.y - (isArea ? AREA_H : DECISION_H) / 2,
      },
    };
  });
}

interface Props {
  root: TreeArea | null;
  unplaced: number;
  /** Which decision is open in the panel beside the tree, if any. */
  selectedId?: string | null;
  onSelect: (decision: TreeDecision) => void;
}

/** The provider is what `useReactFlow` needs to exist above it. */
export function DecisionTreeCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Tree {...props} />
    </ReactFlowProvider>
  );
}

function Tree({ root, unplaced, selectedId, onSelect }: Props) {
  const flow = useReactFlow();
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!root) return;
    // Arrived by a link naming a decision: open the way down to it, so the
    // thing the link promised is the thing on screen.
    const path = selectedId ? pathTo(root, selectedId) : null;
    if (path) {
      setOpen(new Set(path));
      return;
    }
    // Otherwise one rank. Opening two showed thirty-three nodes at once and
    // `fitView` shrank them past reading; the tree is for arriving somewhere in
    // two clicks, not for seeing everything at once.
    setOpen(openToDepth(root, 1, new Set()));
  }, [root, selectedId]);

  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!root) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const walk = (area: TreeArea, parent: string | null) => {
      const id = `area:${area.id || "root"}`;
      const isOpen = open.has(area.id);
      nodes.push({
        id,
        type: "area",
        position: { x: 0, y: 0 },
        data: {
          label: area.label,
          total: area.total,
          open: isOpen,
          leaf: area.children.length === 0 && area.decisions.length === 0,
          onToggle: () => toggle(area.id),
        } satisfies AreaData as unknown as Record<string, unknown>,
      });
      if (parent) {
        edges.push({ id: `${parent}->${id}`, source: parent, target: id, type: "smoothstep" });
      }
      if (!isOpen) return;

      for (const child of area.children) walk(child, id);
      for (const decision of area.decisions) {
        // One memory can hang under several areas, so the node id carries both.
        const leafId = `d:${area.id}:${decision.id}`;
        nodes.push({
          id: leafId,
          type: "decision",
          position: { x: 0, y: 0 },
          data: {
            decision,
            selected: decision.id === selectedId,
            onOpen: () => onSelect(decision),
          } satisfies DecisionData as unknown as Record<string, unknown>,
        });
        edges.push({
          id: `${id}->${leafId}`,
          source: id,
          target: leafId,
          type: "smoothstep",
        });
      }
    };

    walk(root, null);
    return { nodes: layout(nodes, edges), edges };
  }, [root, open, toggle, selectedId, onSelect]);

  /*
   * Re-fit whenever a branch opens or closes.
   *
   * Without this, expanding pushed the new cards off the right edge and the
   * person who just clicked saw nothing happen. Keyed on the node count rather
   * than on every render, so panning and zooming are left alone.
   */
  useEffect(() => {
    if (nodes.length === 0) return;
    // `selectedId` too: opening the panel takes a third of the width, and a
    // tree laid out for the full width then sits under it.
    const at = window.setTimeout(
      () => flow.fitView({ padding: 0.12, maxZoom: 1, duration: 250 }),
      60,
    );
    return () => window.clearTimeout(at);
  }, [nodes.length, selectedId, flow]);

  if (!root || root.total === 0) {
    return (
      <Blank icon={FolderTree} title="Nothing to draw yet">
        The tree is built from the files your memories name. Save one that mentions a path and it
        appears here.
      </Blank>
    );
  }

  return (
    <div className="h-[640px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        defaultEdgeOptions={{ style: { stroke: "var(--border)", strokeWidth: 1.5 } }}
      >
        <Background gap={20} size={1} color="#ebebeb" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {unplaced > 0 && (
        <p className="text-muted-foreground border-border border-t px-4 py-2 text-xs">
          {unplaced} {unplaced === 1 ? "memory names" : "memories name"} no file, so{" "}
          {unplaced === 1 ? "it sits" : "they sit"} under “Not about a file”.
        </p>
      )}
    </div>
  );
}
