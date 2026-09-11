/** Shared formatting so a date or an author reads the same everywhere. */

export function when(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function clock(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * The first line that is actually prose.
 *
 * Headings are skipped, not stripped: the first heading in a body is what
 * became the entry's title, so returning it here printed the same sentence
 * twice in one row — once as the title and again as its own summary.
 */
export function firstLine(content: string, limit = 90): string {
  const lines = content.split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) start = close + 1;
  }
  for (const line of lines.slice(start)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---" || trimmed.startsWith("#")) continue;
    // A bold line on its own is a heading too.
    if (/^\*\*[^*]+\*\*:?$/.test(trimmed)) continue;
    const stripped = trimmed.replace(/\*\*/g, "");
    if (stripped) {
      return stripped.length > limit ? `${stripped.slice(0, limit - 1)}…` : stripped;
    }
  }
  return "(empty)";
}

/** `1 entry` / `4 entries` — a count that reads as English. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The trailing segment of a topic key: `payments/adyen-retry` -> `adyen-retry`. */
export function leaf(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1] ?? name;
}

export function stem(name: string): string {
  const parts = name.split("/");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/` : "";
}

export function ratio(positive: number, negative: number): string | null {
  const up = Number.isFinite(positive) ? positive : 0;
  const down = Number.isFinite(negative) ? negative : 0;
  if (up + down === 0) return null;
  return `${Math.round((up / (up + down)) * 100)}%`;
}
