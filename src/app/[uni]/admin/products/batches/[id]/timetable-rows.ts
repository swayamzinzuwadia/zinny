import { formatDate, formatTime, weekdayLabel } from "@/server/lib/dates";
import type { BatchTimetable } from "@/server/services/schedule";

const WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const weekdayName = (n: number) => WEEKDAY_LONG[n] ?? weekdayLabel(n);

export type TimetableFilter = { sectionId?: string; facultyUserId?: string };

export type TimetableRow =
  | {
      type: "class";
      /** First row of its day: later rows of the same day leave day and date blank. */
      first: boolean;
      dayNumber: number;
      date: string;
      weekday: number;
      startTime: string;
      endTime: string;
      sections: { id: string; title: string; facultyUserId: string | null; facultyName: string | null; topic: string | null }[];
      kind: "regular" | "rescheduled" | "extra";
      note: string | null;
    }
  | { type: "off"; date: string; weekday: number; kind: "cancelled" | "moved"; movedTo: string | null; note: string | null };

/** The dated timetable as flat rows in date order, for the table and the CSV. Filters keep only matching classes. */
export function timetableRows(t: BatchTimetable, filter: TimetableFilter = {}): TimetableRow[] {
  const filtering = !!filter.sectionId || !!filter.facultyUserId;
  const rows: TimetableRow[] = [];
  for (const d of t.days) {
    let first = true;
    for (const e of d.entries) {
      const sections = e.sections.filter((s) => (!filter.sectionId || s.id === filter.sectionId) && (!filter.facultyUserId || s.facultyUserId === filter.facultyUserId));
      if (filtering && sections.length === 0) continue;
      rows.push({ type: "class", first, dayNumber: d.dayNumber, date: d.date, weekday: d.weekday, startTime: e.startTime, endTime: e.endTime, sections, kind: e.kind, note: e.note });
      first = false;
    }
  }
  if (!filtering) for (const o of t.offDays) rows.push({ type: "off", ...o });
  // Stable: rows of one date keep their order.
  return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i).map((x) => x.r);
}

export const KIND_LABEL = { regular: "", rescheduled: "Moved here", extra: "Extra class" } as const;

const cell = (v: string | number) => {
  let s = String(v);
  // A cell starting with = + - @ would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function timetableCsv(t: BatchTimetable, filter: TimetableFilter = {}): string {
  const lines = [["Day", "Date", "Weekday", "Starts", "Ends", "Section", "Faculty", "Topic", "Status", "Note"]];
  for (const r of timetableRows(t, filter)) {
    if (r.type === "off") {
      lines.push(["", r.date, weekdayName(r.weekday), "", "", "", "", "", r.kind === "moved" && r.movedTo ? `Moved to ${formatDate(r.movedTo)}` : "Cancelled", r.note ?? ""]);
      continue;
    }
    lines.push([
      String(r.dayNumber),
      r.date,
      weekdayName(r.weekday),
      formatTime(r.startTime),
      formatTime(r.endTime),
      r.sections.map((s) => s.title).join(" and ") || "Nothing planned",
      [...new Set(r.sections.map((s) => s.facultyName).filter(Boolean))].join(" and "),
      r.sections.map((s) => s.topic).filter(Boolean).join(" · "),
      KIND_LABEL[r.kind] || "Class",
      r.note ?? "",
    ]);
  }
  return lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}
