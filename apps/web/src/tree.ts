/**
 * Pure helpers for the decision tree.
 *
 * Here rather than beside the component because they are recursion over a
 * shape, they are the part that goes wrong, and a test must be able to reach
 * them without pulling React Flow in behind them.
 */

import type { TreeArea } from "@/api";

/**
 * The areas between the root and the one holding `decisionId`, inclusive.
 *
 * A link that lands on a tree with nothing open has not taken you anywhere:
 * the decision it named is three collapsed ranks down. Opening its ancestors is
 * what makes the link mean "here".
 */
export function pathTo(area: TreeArea, decisionId: string): string[] | null {
  if (area.decisions.some((d) => d.id === decisionId)) return [area.id];
  for (const child of area.children) {
    const below = pathTo(child, decisionId);
    if (below) return [area.id, ...below];
  }
  return null;
}
