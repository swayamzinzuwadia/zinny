/** Small pieces shared by every live-classes screen. Server components unless noted. */
import type { ReactNode } from "react";
import { Badge, cx } from "@/components/ui";
import type { ClassSession } from "../engine";
import { formatTime, relativeDay, relativeDayInline, STATUS_LABEL, type AttendanceStatus } from "../time";

export function StatusBadge({ status, auto = false }: { status: AttendanceStatus | null; auto?: boolean }) {
  if (!status) return <Badge>No status yet</Badge>;
  const tone = status === "present" ? "brand" : status === "late" ? "warn" : "danger";
  return (
    <Badge tone={tone}>
      {STATUS_LABEL[status]}
      {auto && <span className="ml-1 font-normal opacity-75">(automatic)</span>}
    </Badge>
  );
}

/** "Today, 9 am to 11 am" (with the date relative to today). */
export function when(s: { date: string; startTime: string; endTime: string }, today: string) {
  return `${relativeDay(s.date, today)}, ${formatTime(s.startTime)} to ${formatTime(s.endTime)}`;
}

/** Inside a sentence: "today from 9 am to 11 am", "on Sat, 7 Nov from 9 am to 11 am". */
export function whenInline(s: { date: string; startTime: string; endTime: string }, today: string) {
  return `${relativeDayInline(s.date, today)} from ${formatTime(s.startTime)} to ${formatTime(s.endTime)}`;
}

export function KindNote({ s }: { s: Pick<ClassSession, "kind" | "note"> }) {
  if (s.kind === "regular") return null;
  return (
    <span className="text-[12px] text-muted">
      {s.kind === "extra" ? "Extra class" : "Moved here"}
      {s.note ? `: ${s.note}` : ""}
    </span>
  );
}

export function StateBadge({ state }: { state: ClassSession["state"] }) {
  if (state === "live") return <Badge tone="gold">On now</Badge>;
  if (state === "open") return <Badge tone="gold">Opening</Badge>;
  if (state === "ended") return <Badge>Ended</Badge>;
  return <Badge>Later</Badge>;
}

/** A percentage, or a dash when nothing has been recorded. Below the threshold reads in the attention colour. */
export function Pct({ value, threshold, className }: { value: number | null; threshold?: number; className?: string }) {
  if (value === null) return <span className={cx("text-faint", className)}>No classes yet</span>;
  const low = threshold !== undefined && value < threshold;
  return <span className={cx("tabular font-medium", low ? "text-gold-strong" : "text-ink", className)}>{value}%</span>;
}

/** A thin bar for a percentage: brand green, or gold when below the threshold, with the threshold marked. */
export function PctBar({ value, threshold }: { value: number | null; threshold: number }) {
  const v = value ?? 0;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={value === null ? "No classes yet" : `${value}%`}>
      <div className={cx("h-full rounded-full", value !== null && v < threshold ? "bg-gold" : "bg-brand")} style={{ width: `${v}%` }} />
      <div className="absolute inset-y-0 w-px bg-ink/30" style={{ left: `${threshold}%` }} />
    </div>
  );
}

/** Host and path of a meeting link, for showing it without the protocol. */
export function LinkText({ url }: { url: string }) {
  let text = url;
  try {
    const u = new URL(url);
    text = `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {}
  return <span className="break-all">{text}</span>;
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap items-center justify-between gap-3", className)}>{children}</div>;
}
