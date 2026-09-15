/**
 * Numbered pages, and how many to a page.
 *
 * "Load more" is right for a catalogue you skim once. An archive is different:
 * you come back to it, you half-remember where a thing was, and you want page 4
 * rather than a button pressed four times. Numbers also say how much there is,
 * which a button cannot.
 *
 * Built on shadcn's `pagination`, so it matches every other control here rather
 * than being a second set of buttons that look nearly the same.
 */

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pageNumbers } from "@/format";

/** The sizes worth offering. Past a hundred rows nobody is reading, they are scrolling. */
export const PER_PAGE = [25, 50, 100];

export function Pager({
  page,
  total,
  perPage,
  busy,
  onPage,
  onPerPage,
  sizes = PER_PAGE,
}: {
  /** One-based, because that is what the buttons say. */
  page: number;
  total: number;
  perPage: number;
  busy?: boolean;
  onPage: (page: number) => void;
  onPerPage?: (perPage: number) => void;
  /** Override when a screen wants a different set, like a dense audit table. */
  sizes?: number[];
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  /*
   * The anchors are for the keyboard and the screen reader, not for navigating:
   * this app is hash-routed, so letting the browser follow `#` would drop the
   * reader on the overview.
   */
  const jump = (to: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    if (!busy && to >= 1 && to <= pages) onPage(to);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-3">
      <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className="tabular-nums">
          {from}–{to} of {total}
        </span>
        {onPerPage && (
          <>
            <span aria-hidden>·</span>
            <Select
              value={String(perPage)}
              onValueChange={(value) => onPerPage(Number(value))}
              disabled={busy}
            >
              <SelectTrigger size="sm" className="h-7 w-auto gap-1" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} per page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={jump(page - 1)}
              aria-disabled={page <= 1}
              className={page <= 1 ? "pointer-events-none opacity-40" : undefined}
            />
          </PaginationItem>

          {pageNumbers(page, pages).map((n, i) => (
            <PaginationItem key={n === "gap" ? `gap-${i}` : n}>
              {n === "gap" ? (
                <PaginationEllipsis />
              ) : (
                // A bare "2" is a poor accessible name; the label says what
                // pressing it does. It was on the hand-rolled version and I
                // lost it moving to the shadcn one.
                <PaginationLink
                  href="#"
                  aria-label={`Page ${n}`}
                  isActive={n === page}
                  onClick={jump(n)}
                >
                  <span className="tabular-nums">{n}</span>
                </PaginationLink>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={jump(page + 1)}
              aria-disabled={page >= pages}
              className={page >= pages ? "pointer-events-none opacity-40" : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
