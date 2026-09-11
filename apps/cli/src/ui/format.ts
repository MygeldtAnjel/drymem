/** Shared formatting, so a date or an author reads the same on every screen. */

import type { EpisodeOut } from "../client.js";

export function when(value: string | null | undefined): string {
  if (!value) return "?";
  return value.slice(0, 16).replace("T", " ");
}

export function author(value: string | null | undefined): string {
  return value ?? "unknown";
}

/** The first non-empty, non-heading line: what the memory is actually about. */
export function firstLine(content: string, limit = 72): string {
  for (const line of content.split("\n")) {
    const stripped = line.trim().replace(/^#+\s*/, "").replace(/^\*\*|\*\*$/g, "");
    if (stripped) return stripped.length > limit ? `${stripped.slice(0, limit - 1)}…` : stripped;
  }
  return "(empty)";
}

export function ratio(positive: number, negative: number): string {
  // Defensive against NaN as well as zero: a number that never arrived must not
  // render as "NaN% useful", which looks like a broken product, not a missing field.
  const up = Number.isFinite(positive) ? positive : 0;
  const down = Number.isFinite(negative) ? negative : 0;
  const total = up + down;
  if (total === 0) return "no ratings yet";
  return `${Math.round((up / total) * 100)}% useful (${total} rated)`;
}

export function episodeLabel(episode: EpisodeOut): string {
  return episode.name || episode.uuid.slice(0, 8);
}
