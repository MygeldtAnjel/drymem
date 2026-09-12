/**
 * Where you are, and how to get back.
 *
 * A trail rather than a back button, because "back" only ever offers one
 * destination and the middle of the path is often the one you want — from a
 * skill you usually mean to return to the catalogue, not to whichever tab you
 * happened to arrive from.
 *
 * The last crumb is the page you are on: rendered as text, not as a link, and
 * marked `aria-current` so a screen reader says so rather than offering a link
 * to here.
 */

import { ChevronRight } from "lucide-react";

import { go } from "@/router";

export interface Crumb {
  label: string;
  /** Where it goes. The last crumb has none — it is where you already are. */
  page?: string;
  id?: string;
  /** Rendered in mono, for anything a machine named. */
  mono?: boolean;
}

export function Crumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-1 text-sm">
        {trail.map((crumb, at) => {
          const last = at === trail.length - 1;
          return (
            <li key={`${crumb.label}-${at}`} className="flex min-w-0 items-center gap-1">
              {at > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />}
              {last || !crumb.page ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={`text-foreground max-w-[22rem] truncate font-medium ${crumb.mono ? "font-mono" : ""}`}
                >
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => go(crumb.page!, crumb.id)}
                  className={`hover:text-foreground max-w-[14rem] truncate rounded transition-colors ${crumb.mono ? "font-mono" : ""}`}
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
