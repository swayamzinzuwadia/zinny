/**
 * Pure calendar logic, no database: turning batch timings into sessions, and the
 * clash check (PRD page 6). Kept pure so it is easy to test exhaustively.
 */
import {
  addDays,
  daysBetween,
  formatTime,
  isoWeekday,
  maxDate,
  minDate,
  timesOverlap,
  toMinutes,
  weekdayLabel,
} from "../lib/dates";

export type Slot = { weekday: number; startTime: string; endTime: string };

export type Override = {
  date: string;
  kind: "cancelled" | "rescheduled" | "extra";
  newDate: string | null;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};

export type ScheduledBatch = {
  batchId: string;
  batchName: string;
  courseId: string;
  courseTitle: string;
  startDate: string;
  endDate: string;
  slots: Slot[];
  overrides?: Override[];
  faculty?: string[];
  joinUrl?: string | null;
};

export type Session = {
  date: string;
  startTime: string;
  endTime: string;
  batchId: string;
  batchName: string;
  courseId: string;
  courseTitle: string;
  faculty: string[];
  joinUrl: string | null;
  kind: "regular" | "rescheduled" | "extra";
  note: string | null;
};

/** All sessions of the given batches between `from` and `to` (inclusive), sorted by time. */
export function expandSessions(batches: ScheduledBatch[], from: string, to: string): Session[] {
  const out: Session[] = [];
  for (const b of batches) {
    const base = {
      batchId: b.batchId,
      batchName: b.batchName,
      courseId: b.courseId,
      courseTitle: b.courseTitle,
      faculty: b.faculty ?? [],
      joinUrl: b.joinUrl ?? null,
    };
    const overrides = b.overrides ?? [];
    const removedDates = new Set(overrides.filter((o) => o.kind !== "extra").map((o) => o.date));

    const start = maxDate(from, b.startDate);
    const end = minDate(to, b.endDate);
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (removedDates.has(d)) continue;
      const wd = isoWeekday(d);
      for (const s of b.slots) {
        if (s.weekday === wd) out.push({ ...base, date: d, startTime: s.startTime, endTime: s.endTime, kind: "regular", note: null });
      }
    }
    for (const o of overrides) {
      if (o.kind === "rescheduled" && o.newDate && o.startTime && o.endTime && o.newDate >= from && o.newDate <= to) {
        out.push({ ...base, date: o.newDate, startTime: o.startTime, endTime: o.endTime, kind: "rescheduled", note: o.note });
      }
      if (o.kind === "extra" && o.startTime && o.endTime && o.date >= from && o.date <= to) {
        out.push({ ...base, date: o.date, startTime: o.startTime, endTime: o.endTime, kind: "extra", note: o.note });
      }
    }
  }
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

export type Clash = {
  batchId: string;
  batchName: string;
  courseTitle: string;
  weekday: number;
  /** e.g. "Mon 9 am–11 am" */
  when: string;
};

/**
 * Does `candidate` overlap any batch the student already has?
 * Two batches clash when their date ranges overlap AND, on a weekday that
 * actually occurs in that overlap, their timings overlap.
 */
export function findClashes(candidate: ScheduledBatch, existing: ScheduledBatch[]): Clash[] {
  const clashes: Clash[] = [];
  for (const other of existing) {
    if (other.batchId === candidate.batchId) continue;
    const from = maxDate(candidate.startDate, other.startDate);
    const to = minDate(candidate.endDate, other.endDate);
    if (from > to) continue;

    const weekdaysInOverlap = new Set<number>();
    const span = Math.min(daysBetween(from, to), 6);
    for (let i = 0; i <= span; i++) weekdaysInOverlap.add(isoWeekday(addDays(from, i)));

    const seen = new Set<number>();
    for (const a of candidate.slots) {
      for (const b of other.slots) {
        if (a.weekday !== b.weekday || !weekdaysInOverlap.has(a.weekday) || seen.has(a.weekday)) continue;
        if (timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
          seen.add(a.weekday);
          clashes.push({
            batchId: other.batchId,
            batchName: other.batchName,
            courseTitle: other.courseTitle,
            weekday: a.weekday,
            when: `${weekdayLabel(b.weekday)} ${formatTime(b.startTime)}–${formatTime(b.endTime)}`,
          });
        }
      }
    }
  }
  return clashes;
}

/** Slots inside one batch must not overlap each other. */
export function validateSlots(slots: Slot[]): string | null {
  if (slots.length === 0) return "Add at least one day and time.";
  for (const s of slots) {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) return "Pick a valid day.";
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s.startTime) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(s.endTime))
      return "Times must look like 09:00.";
    if (toMinutes(s.endTime) <= toMinutes(s.startTime)) return "Each class must end after it starts.";
  }
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++)
      if (
        slots[i].weekday === slots[j].weekday &&
        timesOverlap(slots[i].startTime, slots[i].endTime, slots[j].startTime, slots[j].endTime)
      )
        return `Two classes overlap on ${weekdayLabel(slots[i].weekday)}.`;
  return null;
}

/** "Mon to Fri, 9 am to 11 am" when all days share one time, otherwise a day-by-day list. */
export function describeSlots(slots: Slot[]): string {
  if (slots.length === 0) return "No timings yet";
  const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const sameTime = sorted.every((s) => s.startTime === sorted[0].startTime && s.endTime === sorted[0].endTime);
  if (sameTime) {
    const days = sorted.map((s) => s.weekday);
    const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    const dayText =
      consecutive && days.length > 2
        ? `${weekdayLabel(days[0])} to ${weekdayLabel(days[days.length - 1])}`
        : days.map(weekdayLabel).join(days.length === 2 ? " and " : ", ");
    return `${dayText}, ${formatTime(sorted[0].startTime)} to ${formatTime(sorted[0].endTime)}`;
  }
  return sorted.map((s) => `${weekdayLabel(s.weekday)} ${formatTime(s.startTime)}–${formatTime(s.endTime)}`).join(", ");
}
