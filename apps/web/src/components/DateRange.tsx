/**
 * A window of days, as one control.
 *
 * Two `<input type="date">` boxes were the quick version and they look like a
 * browser rather than like this app: the rendering is the platform's, the
 * placeholder is `mm/dd/yyyy` whatever your locale, and there is no way to see
 * the two ends of a range against each other. This is the shadcn calendar in a
 * popover, which is the same furniture as every other control here.
 */

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { DateRange as Range } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** `YYYY-MM-DD` in UTC, which is what the API filters on. */
export function asDay(at: Date | undefined): string | undefined {
  if (!at) return undefined;
  const utc = new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()));
  return utc.toISOString().slice(0, 10);
}

/** The reverse, tolerant of the empty string the API leaves out. */
function fromDay(day: string | undefined): Date | undefined {
  if (!day) return undefined;
  const at = new Date(`${day}T00:00:00`);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function label(from?: string, to?: string): string {
  const show = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  if (from && to) return from === to ? show(from) : `${show(from)} – ${show(to)}`;
  if (from) return `From ${show(from)}`;
  if (to) return `Until ${show(to)}`;
  return "Any time";
}

export function DateRange({
  from,
  to,
  disabled,
  onChange,
}: {
  from?: string;
  to?: string;
  disabled?: boolean;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = Boolean(from || to);

  return (
    // The clear control sits *beside* the trigger, not inside it: a button
    // nested in a button is invalid, and it makes the outer one ambiguous to
    // anything reading the page by role — including the tests.
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className={chosen ? undefined : "text-muted-foreground font-normal"}
          >
            <CalendarDays data-icon="inline-start" />
            {label(from, to)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            autoFocus
            defaultMonth={fromDay(from) ?? new Date()}
            selected={{ from: fromDay(from), to: fromDay(to) } as Range}
            onSelect={(range: Range | undefined) =>
              onChange({ from: asDay(range?.from), to: asDay(range?.to) })
            }
          />
        </PopoverContent>
      </Popover>

      {chosen && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear the dates"
          disabled={disabled}
          onClick={() => onChange({})}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
