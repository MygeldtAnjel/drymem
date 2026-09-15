/**
 * The two charts this product has data for.
 *
 * Deliberately two. A dashboard of six charts nobody reads is worse than two
 * that answer a question somebody actually has: *is this project still writing
 * anything down*, and *what kind of thing does it write*. Both come from counts
 * the API already had to compute, so neither costs a query.
 */

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { Day } from "@/api";
import { TYPES } from "@/memory";

/** `2026-09-14` as `14 Sep`, which is what fits under a bar. */
function short(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime())
    ? day
    : at.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Activity over the last month.
 *
 * Bars rather than a line: these are counts of discrete events on discrete
 * days, and a line between them implies a value at 3pm on Tuesday that does
 * not exist.
 */
export function PerDayChart({
  data,
  label,
  className,
}: {
  data: Day[];
  label: string;
  className?: string;
}) {
  // Every day is zero: a chart of thirty empty bars says less than a sentence.
  if (data.length === 0 || data.every((d) => d.n === 0)) return null;

  const config = { n: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={data.map((d) => ({ ...d, when: short(d.day) }))} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="when"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          fontSize={11}
        />
        <YAxis
          width={28}
          tickLine={false}
          axisLine={false}
          fontSize={11}
          allowDecimals={false}
        />
        <ChartTooltip content={<ChartTooltipContent labelKey="when" />} />
        <Bar dataKey="n" fill="var(--color-n)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * What kinds of memory a project writes.
 *
 * Horizontal, because the labels are words — "architecture" rotated forty-five
 * degrees under a vertical bar is a label nobody reads.
 */
export function ByKindChart({
  byType,
  className,
}: {
  byType: Record<string, number>;
  className?: string;
}) {
  // The schema's order, not the counts': a chart that reorders itself as the
  // numbers move is one you have to re-read every time you look at it.
  const rows = Object.keys(TYPES)
    .map((kind) => ({ kind, n: byType[kind] ?? 0 }))
    .filter((row) => row.n > 0);
  if (rows.length === 0) return null;

  const config = { n: { label: "Memories", color: "var(--chart-2)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={className}>
      <BarChart data={rows} layout="vertical" accessibilityLayer margin={{ left: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="kind"
          width={92}
          tickLine={false}
          axisLine={false}
          fontSize={11}
          className="capitalize"
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="n" fill="var(--color-n)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
