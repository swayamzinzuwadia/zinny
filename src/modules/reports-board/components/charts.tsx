"use client";

/**
 * Insights charts, drawn with Recharts in the brand colours. The SVG is hidden from screen
 * readers: each chart's takeaway sentence and its "Show as a table" fallback carry the
 * same information in text (see chart-card.tsx). Values may be negative.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatHours, formatMoney, formatMoneyShort, formatNumber, formatPercent } from "../lib/format";
import { CHART } from "./chart-theme";

export type ValueFormat = "count" | "money" | "percent" | "hours";

export type Datum = {
  label: string;
  value: number;
  /** Gold: the current week or month. */
  highlight?: boolean;
  /** Extra line in the tooltip, e.g. "12 of 15 seats". */
  note?: string;
};

function fullValue(v: number, f: ValueFormat): string {
  if (f === "money") return formatMoney(v);
  if (f === "percent") return formatPercent(v);
  if (f === "hours") return formatHours(v);
  return formatNumber(v);
}

function shortValue(v: number, f: ValueFormat): string {
  if (f === "money") return formatMoneyShort(v);
  if (f === "percent") return `${formatNumber(Math.round(v))}%`;
  if (f === "hours") return `${formatNumber(v)}h`;
  return formatNumber(v);
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const AXIS_TICK = { fill: CHART.muted, fontSize: 12 };

type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; format: ValueFormat };

function ChartTooltip({ active, payload, format }: TooltipProps) {
  const d = payload?.[0]?.payload as Datum | undefined;
  if (!active || !d) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
      <div className="text-muted">{d.label}</div>
      <div className="tabular font-medium text-ink">{fullValue(d.value, format)}</div>
      {d.note && <div className="text-[12px] text-muted">{d.note}</div>}
    </div>
  );
}

/** Domain that always includes zero, so bars grow from the axis and negatives show below it. */
function domainFor(data: Datum[], format: ValueFormat, max?: number): [number, number] {
  const values = data.map((d) => d.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, max ?? 0, ...values);
  // An all-zero chart still needs a visible scale.
  return [lo, hi === lo ? (format === "percent" ? 100 : 1) : hi];
}

/** Vertical columns along a time axis: weeks or months. */
export function ColumnChart({ data, format, height = 240 }: { data: Datum[]; format: ValueFormat; height?: number }) {
  const [lo, hi] = domainFor(data, format);
  return (
    <div aria-hidden="true" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={CHART.line} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART.line }} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={6} />
          <YAxis
            width={58}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            allowDecimals={format !== "count"}
            domain={[lo, hi]}
            tickFormatter={(v: number) => shortValue(v, format)}
          />
          {lo < 0 && <ReferenceLine y={0} stroke={CHART.muted} />}
          <Tooltip cursor={{ fill: CHART.brandSoft, fillOpacity: 0.7 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} format={format} />} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.highlight ? CHART.gold : CHART.brand} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Horizontal bars, one per course, batch or person. With `max` (e.g. 100 for a fill rate)
 * each bar sits on a cream track that shows how far it could go.
 */
export function BarList({ data, format, max, labelWidth = 180 }: { data: Datum[]; format: ValueFormat; max?: number; labelWidth?: number }) {
  const [lo, hi] = domainFor(data, format, max);
  const height = Math.max(96, data.length * 34 + 36);
  const chars = Math.floor(labelWidth / 7);
  return (
    <div aria-hidden="true" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid horizontal={false} stroke={CHART.line} />
          <XAxis
            type="number"
            domain={[lo, hi]}
            tickLine={false}
            axisLine={{ stroke: CHART.line }}
            tick={AXIS_TICK}
            allowDecimals={format !== "count"}
            tickFormatter={(v: number) => shortValue(v, format)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ ...AXIS_TICK, fill: CHART.ink }}
            tickFormatter={(v: string) => truncate(v, chars)}
          />
          {lo < 0 && <ReferenceLine x={0} stroke={CHART.muted} />}
          <Tooltip cursor={{ fill: CHART.brandSoft, fillOpacity: 0.7 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} format={format} />} />
          <Bar
            dataKey="value"
            radius={[0, 6, 6, 0]}
            barSize={18}
            isAnimationActive={false}
            background={max !== undefined ? { fill: CHART.line, radius: 6 } : undefined}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.highlight ? CHART.gold : CHART.brand} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
