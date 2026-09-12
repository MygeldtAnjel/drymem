/**
 * A line diff, for `drymem skills diff`.
 *
 * Written here rather than pulled in: the only consumer compares two versions
 * of one Markdown file, and a dependency that ships a patch parser and three
 * output formats for that is not worth the install on every developer's
 * machine. Plain LCS over lines, which is what `diff -u` shows anyway.
 */

export interface Hunk {
  kind: "same" | "add" | "remove";
  line: string;
}

/** Longest common subsequence of two line arrays, as an edit script. */
export function lineDiff(before: string, after: string): Hunk[] {
  const a = before.split("\n");
  const b = after.split("\n");

  // table[i][j] = length of the LCS of a[i..] and b[j..].
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", line: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "remove", line: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", line: b[j]! });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "remove", line: a[i]! });
  for (; j < b.length; j++) out.push({ kind: "add", line: b[j]! });
  return out;
}

/**
 * Unified-style output with `context` unchanged lines around each change.
 * Everything else collapses to a `…` marker — a skill is mostly prose that did
 * not move, and printing all of it buries the two lines that did.
 */
export function unified(hunks: Hunk[], context = 2): string[] {
  const keep = new Set<number>();
  hunks.forEach((hunk, at) => {
    if (hunk.kind === "same") return;
    for (let k = at - context; k <= at + context; k++) {
      if (k >= 0 && k < hunks.length) keep.add(k);
    }
  });

  const lines: string[] = [];
  let elided = false;
  hunks.forEach((hunk, at) => {
    if (!keep.has(at)) {
      if (!elided) lines.push("  …");
      elided = true;
      return;
    }
    elided = false;
    lines.push(`${hunk.kind === "add" ? "+ " : hunk.kind === "remove" ? "- " : "  "}${hunk.line}`);
  });
  return lines;
}

export const changed = (hunks: Hunk[]): { added: number; removed: number } => ({
  added: hunks.filter((h) => h.kind === "add").length,
  removed: hunks.filter((h) => h.kind === "remove").length,
});
