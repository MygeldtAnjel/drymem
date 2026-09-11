/**
 * The small shared pieces: type and scope chips, stat tiles, states.
 *
 * Every one pairs its colour with a word and usually an icon. The states this
 * product trades in have to survive greyscale and colour-blindness — that was
 * a stated requirement, not a preference — so hue only ever confirms a label
 * it never replaces.
 */

import { Lock, Users, type LucideIcon } from "lucide-react";

import { Badge } from "./ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { TYPES } from "@/memory";
import { cn } from "@/lib/utils";

export function TypeChip({ type, className }: { type: string; className?: string }) {
  const known = type in TYPES ? type : "note";
  return (
    <span
      title={TYPES[known]}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize",
        `chip-${known}`,
        className,
      )}
    >
      {type}
    </span>
  );
}

export function ScopeChip({ scope }: { scope: string }) {
  return scope === "team" ? (
    <Badge variant="outline" className="text-success">
      <Users /> Shared
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      <Lock /> Private
    </Badge>
  );
}

export function RatingChip({ rating }: { rating: number | null }) {
  if (rating === 1) return <Badge className="bg-primary/15 text-primary">Useful</Badge>;
  if (rating === -1) return <Badge variant="outline">Not useful</Badge>;
  return null;
}

export function Blank({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** A loading placeholder shaped like the rows that are coming. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
