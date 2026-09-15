/**
 * Numbered pages.
 *
 * "Load more" is right for a catalogue you skim once. An archive is different:
 * you come back to it, you remember roughly where a thing was, and you want to
 * go to page 4 rather than press a button four times and lose the place on the
 * next visit. Numbers also tell you how much there is, which a button cannot.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pageNumbers } from "@/format";

export function Pager({
  page,
  total,
  perPage,
  busy,
  onPage,
}: {
  /** One-based, because that is what the buttons say. */
  page: number;
  total: number;
  perPage: number;
  busy?: boolean;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
      <p className="text-muted-foreground text-xs">
        {from}–{to} of {total}
      </p>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={busy || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft />
        </Button>

        {pageNumbers(page, pages).map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className="text-muted-foreground px-1 text-xs">
              …
            </span>
          ) : (
            <Button
              key={n}
              size="icon-sm"
              variant={n === page ? "secondary" : "ghost"}
              aria-label={`Page ${n}`}
              aria-current={n === page ? "page" : undefined}
              disabled={busy}
              onClick={() => onPage(n)}
            >
              <span className="text-xs tabular-nums">{n}</span>
            </Button>
          ),
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={busy || page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
