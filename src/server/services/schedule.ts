/**
 * Pure calendar logic, no database: turning batch timings into sessions, and the
 * clash check (PRD page 6). Kept pure so it is easy to test exhaustively.
 */
import {
  addDays,
  daysBetween,
  formatDate,
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
  /** From the batch's day-number plan, when the timetable was read with it (annotateSessions). */
  dayNumber?: number;
  /** The section taught in this class ("Direct tax"), or several joined with "and". */
  section?: string;
  /** Who teaches that section. Empty or missing: fall back to `faculty`. */
  sectionFaculty?: string[];
  topic?: string | null;
  /** On a faculty member's own timetable: they teach this class's section. */
  taughtByMe?: boolean;
  /** On a student's timetable: their other classes at the same time (markClashes). */
  clashesWith?: SessionClash[];
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
  /** e.g. "Mon 9 am–11 am", or for a one-off class "Sat, 21 Nov, 2 pm–4 pm" */
  when: string;
  /** Set for a clash on one date only: a class of either batch that was moved or added. */
  date?: string;
};

/** At most this many one-off clashes are reported per pair of batches: the warning only needs the first few. */
export const MAX_ONE_OFF_CLASHES = 6;

/** A batch's one-off classes (moved here or extra), wherever they fall. */
function oneOffSessions(b: ScheduledBatch): Session[] {
  const dated = (b.overrides ?? []).filter((o) => (o.kind === "rescheduled" && o.newDate) || o.kind === "extra");
  if (dated.length === 0) return [];
  const dates = dated.map((o) => (o.kind === "rescheduled" ? o.newDate! : o.date)).sort();
  return expandSessions([{ ...b, slots: [] }], dates[0], dates[dates.length - 1]).filter((s) => s.kind !== "regular");
}

/**
 * Does `candidate` overlap any batch the student already has?
 *
 * Weekly: two batches clash when their date ranges overlap AND, on a weekday that actually
 * occurs in that overlap, their weekly timings overlap. Reported once per weekday ("Mon 9 am–11 am").
 *
 * One-off: a class moved or added on a single date, by either batch, that lands on a class of
 * the other batch clashes on that date ("Sat, 21 Nov, 2 pm–4 pm"). Only the dates of one-off
 * classes are expanded, so the work stays small however long the batches run, and at most
 * MAX_ONE_OFF_CLASHES are reported per pair.
 */
export function findClashes(candidate: ScheduledBatch, existing: ScheduledBatch[]): Clash[] {
  const clashes: Clash[] = [];
  const candidateOneOffs = oneOffSessions(candidate);
  for (const other of existing) {
    if (other.batchId === candidate.batchId) continue;
    const label = { batchId: other.batchId, batchName: other.batchName, courseTitle: other.courseTitle };
    const from = maxDate(candidate.startDate, other.startDate);
    const to = minDate(candidate.endDate, other.endDate);

    if (from <= to) {
      const weekdaysInOverlap = new Set<number>();
      const span = Math.min(daysBetween(from, to), 6);
      for (let i = 0; i <= span; i++) weekdaysInOverlap.add(isoWeekday(addDays(from, i)));

      const seen = new Set<number>();
      for (const a of candidate.slots) {
        for (const b of other.slots) {
          if (a.weekday !== b.weekday || !weekdaysInOverlap.has(a.weekday) || seen.has(a.weekday)) continue;
          if (timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
            seen.add(a.weekday);
            clashes.push({ ...label, weekday: a.weekday, when: `${weekdayLabel(b.weekday)} ${formatTime(b.startTime)}–${formatTime(b.endTime)}` });
          }
        }
      }
    }

    // One-off classes can fall outside a batch's own dates, so they are checked whatever the overlap.
    const pairs: { date: string; mine: Session; theirs: Session }[] = [];
    for (const mine of candidateOneOffs) {
      for (const theirs of expandSessions([other], mine.date, mine.date)) pairs.push({ date: mine.date, mine, theirs });
    }
    for (const theirs of oneOffSessions(other)) {
      // The candidate's own one-offs were paired above.
      for (const mine of expandSessions([candidate], theirs.date, theirs.date)) if (mine.kind === "regular") pairs.push({ date: theirs.date, mine, theirs });
    }
    const dated = new Set<string>();
    for (const { date, mine, theirs } of pairs.sort((x, y) => (x.date + x.theirs.startTime).localeCompare(y.date + y.theirs.startTime))) {
      if (dated.size >= MAX_ONE_OFF_CLASHES) break;
      const key = `${date} ${theirs.startTime}`;
      if (dated.has(key) || !timesOverlap(mine.startTime, mine.endTime, theirs.startTime, theirs.endTime)) continue;
      dated.add(key);
      clashes.push({
        ...label,
        weekday: isoWeekday(date),
        date,
        when: `${formatDate(date, { weekday: true })}, ${formatTime(theirs.startTime)}–${formatTime(theirs.endTime)}`,
      });
    }
  }
  return clashes;
}

/** Another class a session overlaps on a student's timetable. */
export type SessionClash = { batchId: string; batchName: string; courseTitle: string; startTime: string; endTime: string };

/**
 * Marks each session that overlaps a session of another batch on the same date: the student
 * can't be in both. For a student's own timetable, after they joined despite the warning.
 */
export function markClashes(sessions: Session[]): Session[] {
  const byDate = new Map<string, Session[]>();
  for (const s of sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return sessions.map((s) => {
    const hits = (byDate.get(s.date) ?? []).filter((o) => o.batchId !== s.batchId && timesOverlap(o.startTime, o.endTime, s.startTime, s.endTime));
    if (hits.length === 0) return s;
    return { ...s, clashesWith: hits.map((o) => ({ batchId: o.batchId, batchName: o.batchName, courseTitle: o.courseTitle, startTime: o.startTime, endTime: o.endTime })) };
  });
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

/* ───────────────────── The day-number plan → a dated timetable ─────────────────────
 *
 * A batch's sections are planned by day number ("Days 1-5 are Direct tax"), never by date.
 * "Day N" is the batch's Nth class date: the distinct dates expandSessions() gives for the
 * batch, in order. Nothing dated is stored, so cancelling a class, moving one, adding an
 * extra class or changing the batch's dates or weekly timings shifts every later day by itself.
 */

export type PlanSection = {
  id: string;
  title: string;
  position: number;
  facultyUserId: string | null;
  facultyName: string | null;
  /** The last date this faculty member can teach on (visiting faculty whose access ends). */
  facultyAccessEndsOn?: string | null;
};

export type PlanDay = {
  sectionId: string;
  dayNumber: number;
  topic?: string | null;
  /** Only when a day is shared by several sections and this one needs its own time. */
  startTime?: string | null;
  endTime?: string | null;
};

export type TimetableSection = { id: string; title: string; facultyUserId: string | null; facultyName: string | null; topic: string | null };

export type TimetableEntry = {
  startTime: string;
  endTime: string;
  kind: Session["kind"];
  note: string | null;
  /** Empty when nothing is planned for this class. */
  sections: TimetableSection[];
};

export type TimetableDay = {
  dayNumber: number;
  date: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  entries: TimetableEntry[];
  planned: boolean;
  /** More than one section teaches on this day. */
  shared: boolean;
};

/** A date that would have had a class but doesn't: it has no day number. */
export type OffDay = { date: string; weekday: number; kind: "cancelled" | "moved"; movedTo: string | null; note: string | null };

export type PlanProblem = {
  code:
    | "no_class_days"
    | "no_plan"
    | "beyond_dates"
    | "unplanned_days"
    | "section_without_days"
    | "section_without_faculty"
    | "faculty_access_ends"
    | "time_outside_class";
  /** What is wrong, in a sentence. */
  message: string;
  /** How to fix it. */
  fix: string;
  sectionId?: string;
  dayNumbers?: number[];
};

export type BatchTimetable = {
  days: TimetableDay[];
  offDays: OffDay[];
  problems: PlanProblem[];
  /** How many class days the batch's dates give. */
  classDays: number;
  /** The highest day number in the plan (0 when nothing is planned). */
  lastPlannedDay: number;
};

/** A plan can't run longer than this many class days. */
export const MAX_PLAN_DAY = 730;

/**
 * Days typed as ranges, "1-5, 8, 10-12", into a sorted list without repeats.
 * An empty text is an empty list (a section with no days yet).
 */
export function parseDayRanges(text: string): { days: number[]; error: null } | { days: null; error: string } {
  const fail = (error: string) => ({ days: null, error });
  const cleaned = text
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/\bdays?\b/gi, " ")
    .replace(/\s*-\s*/g, "-");
  const tokens = cleaned.split(/[\s,;]+/).filter(Boolean);
  const days = new Set<number>();
  for (const t of tokens) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(t);
    if (!m) return fail(`"${t}" isn't a day or a range of days. Write days like 1-5, 8, 10-12.`);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < 1) return fail("Day numbers start at 1.");
    if (b < a) return fail(`"${t}" runs backwards. Write it as ${b}-${a}.`);
    if (b > MAX_PLAN_DAY) return fail(`Day ${b} is too far out. A plan can have up to ${MAX_PLAN_DAY} days.`);
    for (let d = a; d <= b; d++) days.add(d);
  }
  return { days: [...days].sort((x, y) => x - y), error: null };
}

/** [1,2,3,4,5,8,10,11,12] → "1-5, 8, 10-12". */
export function formatDayRanges(days: number[], dash = "-"): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j === i ? `${sorted[i]}` : `${sorted[i]}${dash}${sorted[j]}`);
    i = j;
  }
  return parts.join(", ");
}

/** "Day 6", "Days 6–7 and 12". */
function dayList(days: number[]): string {
  const parts = formatDayRanges(days, "–").split(", ");
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${days.length === 1 ? "Day" : "Days"} ${text}`;
}

/**
 * Every session of one batch. The range is the batch's own dates, widened to take in a class
 * moved or added outside them, so the full timetable matches what the weekly view shows.
 */
export function batchSessions(batch: ScheduledBatch): Session[] {
  let from = batch.startDate;
  let to = batch.endDate;
  for (const o of batch.overrides ?? []) {
    const d = o.kind === "rescheduled" ? o.newDate : o.kind === "extra" ? o.date : null;
    if (!d || !o.startTime || !o.endTime) continue;
    from = minDate(from, d);
    to = maxDate(to, d);
  }
  return expandSessions([batch], from, to);
}

/** The batch's class dates in order: index 0 is Day 1. */
export function classDates(batch: ScheduledBatch): string[] {
  return [...new Set(batchSessions(batch).map((s) => s.date))];
}

type Planned = { section: PlanSection; plan: PlanDay };

const hasOwnTime = (p: Planned) => !!p.plan.startTime && !!p.plan.endTime;
const during = (p: Planned, s: { startTime: string; endTime: string }) => timesOverlap(p.plan.startTime!, p.plan.endTime!, s.startTime, s.endTime);
const asSection = (p: Planned): TimetableSection => ({
  id: p.section.id,
  title: p.section.title,
  facultyUserId: p.section.facultyUserId,
  facultyName: p.section.facultyName,
  topic: p.plan.topic?.trim() || null,
});

/**
 * Who teaches when on one class day. Sections with their own times use them. The others are
 * paired with the day's sessions in order; with more sections than sessions the last session
 * is shared, and with fewer the last section carries on through the remaining sessions.
 */
function pairDay(sessions: Session[], planned: Planned[]): { entries: TimetableEntry[]; outside: Planned[] } {
  const own = planned.filter(hasOwnTime);
  const rest = planned.filter((p) => !hasOwnTime(p));
  const free = sessions.filter((s) => !own.some((p) => during(p, s)));
  // Sessions already split up by sections with their own times are left to those sections.
  const pool = rest.length > 0 && free.length === 0 ? sessions : free;
  const entries: TimetableEntry[] = [];
  const outside: Planned[] = [];

  pool.forEach((s, i) => {
    let mine: Planned[] = [];
    if (rest.length > 0) {
      const last = i === pool.length - 1;
      mine = i >= rest.length ? [rest[rest.length - 1]] : last ? rest.slice(i) : [rest[i]];
    }
    entries.push({ startTime: s.startTime, endTime: s.endTime, kind: s.kind, note: s.note, sections: mine.map(asSection) });
  });
  for (const p of own) {
    const session = sessions.find((s) => during(p, s));
    if (!session) outside.push(p);
    const from = session ?? sessions[0];
    entries.push({ startTime: p.plan.startTime!, endTime: p.plan.endTime!, kind: from.kind, note: from.note, sections: [asSection(p)] });
  }

  // Sections with exactly the same time are one row.
  const merged: TimetableEntry[] = [];
  entries.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || toMinutes(a.endTime) - toMinutes(b.endTime));
  for (const e of entries) {
    const same = merged.find((m) => toMinutes(m.startTime) === toMinutes(e.startTime) && toMinutes(m.endTime) === toMinutes(e.endTime));
    if (same) same.sections.push(...e.sections.filter((s) => !same.sections.some((x) => x.id === s.id)));
    else merged.push({ ...e, sections: [...e.sections] });
  }
  return { entries: merged, outside };
}

/**
 * The whole batch, one row per class day: day number, date, times, and which sections and
 * faculty teach it. Computed from the batch's calendar and the day-number plan; never stored.
 * Problems are reported, not thrown: a plan may be written before the dates are final.
 */
export function batchTimetable(batch: ScheduledBatch, sections: PlanSection[], planDays: PlanDay[]): BatchTimetable {
  const sessions = batchSessions(batch);
  const byDate = new Map<string, Session[]>();
  for (const s of sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const dates = [...byDate.keys()];

  const ordered = [...sections].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const order = new Map(ordered.map((s, i) => [s.id, i]));
  const byDay = new Map<number, Planned[]>();
  for (const plan of planDays) {
    const section = ordered[order.get(plan.sectionId) ?? -1];
    if (!section) continue;
    byDay.set(plan.dayNumber, [...(byDay.get(plan.dayNumber) ?? []), { section, plan }]);
  }
  for (const list of byDay.values()) list.sort((a, b) => order.get(a.section.id)! - order.get(b.section.id)!);

  const problems: PlanProblem[] = [];
  const outside: { p: Planned; sessions: Session[] }[] = [];
  const days: TimetableDay[] = dates.map((date, i) => {
    const planned = byDay.get(i + 1) ?? [];
    const paired = pairDay(byDate.get(date)!, planned);
    for (const p of paired.outside) outside.push({ p, sessions: byDate.get(date)! });
    return { dayNumber: i + 1, date, weekday: isoWeekday(date), entries: paired.entries, planned: planned.length > 0, shared: planned.length > 1 };
  });

  // Dates that lost their class (and aren't class days through an extra class).
  const offDays: OffDay[] = [];
  const slotDays = new Set(batch.slots.map((s) => s.weekday));
  for (const o of batch.overrides ?? []) {
    if (o.kind === "extra" || byDate.has(o.date) || offDays.some((d) => d.date === o.date)) continue;
    if (o.date < batch.startDate || o.date > batch.endDate || !slotDays.has(isoWeekday(o.date))) continue;
    offDays.push({
      date: o.date,
      weekday: isoWeekday(o.date),
      kind: o.kind === "rescheduled" ? "moved" : "cancelled",
      movedTo: o.kind === "rescheduled" ? o.newDate : null,
      note: o.note,
    });
  }
  offDays.sort((a, b) => a.date.localeCompare(b.date));

  const classDays = dates.length;
  const plannedNumbers = [...byDay.keys()].sort((a, b) => a - b);
  const lastPlannedDay = plannedNumbers[plannedNumbers.length - 1] ?? 0;

  if (classDays === 0) {
    problems.push({
      code: "no_class_days",
      message: "These dates and timings give no class days.",
      fix: "Check the batch's start and end dates and its weekly timings under Batch details.",
    });
  }
  if (plannedNumbers.length === 0) {
    problems.push({
      code: "no_plan",
      message: ordered.length === 0 ? "This batch has no sections yet." : "No days are planned yet.",
      fix: "Add sections and give each one its days under Sections and plan.",
    });
  } else {
    const beyond = plannedNumbers.filter((n) => n > classDays);
    if (beyond.length > 0 && classDays > 0) {
      problems.push({
        code: "beyond_dates",
        message: `${dayList(beyond)} ${beyond.length === 1 ? "is" : "are"} planned but these dates only have ${classDays} class ${classDays === 1 ? "day" : "days"}.`,
        fix: "Move the end date later, add an extra class, or take those days out of the plan.",
        dayNumbers: beyond,
      });
    }
    const gaps = days.filter((d) => !d.planned).map((d) => d.dayNumber);
    if (gaps.length > 0) {
      problems.push({
        code: "unplanned_days",
        message: `${dayList(gaps)} ${gaps.length === 1 ? "has" : "have"} nothing planned.`,
        fix: "Add those days to a section, or cancel those classes so later days move up.",
        dayNumbers: gaps,
      });
    }
  }
  for (const s of ordered) {
    const mine = planDays.filter((p) => p.sectionId === s.id).sort((a, b) => a.dayNumber - b.dayNumber);
    if (mine.length === 0 && plannedNumbers.length > 0) {
      problems.push({ code: "section_without_days", message: `${s.title} has no days yet.`, fix: "Enter its days, like 1-5, 8.", sectionId: s.id });
    }
    if (!s.facultyUserId) {
      problems.push({ code: "section_without_faculty", message: `${s.title} has no faculty.`, fix: "Pick who teaches it under Sections and plan.", sectionId: s.id });
    } else if (s.facultyAccessEndsOn) {
      const late = mine.filter((p) => p.dayNumber <= classDays && days[p.dayNumber - 1].date > s.facultyAccessEndsOn!);
      if (late.length > 0) {
        const first = days[late[0].dayNumber - 1];
        const firstDay = `Day ${first.dayNumber} (${formatDate(first.date, { weekday: true })})`;
        problems.push({
          code: "faculty_access_ends",
          message:
            `${s.facultyName ?? "The faculty member"}'s access ends on ${formatDate(s.facultyAccessEndsOn)}, before ` +
            (late.length === 1 ? `${firstDay} of ${s.title}.` : `${late.length} of their days in ${s.title}, starting with ${firstDay}.`),
          fix: "Extend their access under Users, or pick someone else for this section.",
          sectionId: s.id,
          dayNumbers: late.map((p) => p.dayNumber),
        });
      }
    }
  }
  for (const { p, sessions: daySessions } of outside) {
    const classTime = daySessions.map((s) => `${formatTime(s.startTime)}–${formatTime(s.endTime)}`).join(", ");
    problems.push({
      code: "time_outside_class",
      message: `${p.section.title} on Day ${p.plan.dayNumber} is set for ${formatTime(p.plan.startTime!)}–${formatTime(p.plan.endTime!)}, outside the class time (${classTime}).`,
      fix: "Change the section's time for that day, or move the class.",
      sectionId: p.section.id,
      dayNumbers: [p.plan.dayNumber],
    });
  }

  return { days, offDays, problems, classDays, lastPlannedDay };
}

/**
 * Adds the plan to a batch's sessions: day number, section, that section's faculty and the
 * topic. A session with nothing planned only gets its day number, and callers fall back to
 * the batch's faculty.
 */
export function annotateSessions(sessions: Session[], batchId: string, timetable: BatchTimetable, viewerUserId?: string): Session[] {
  const byDate = new Map(timetable.days.map((d) => [d.date, d]));
  return sessions.map((s) => {
    if (s.batchId !== batchId) return s;
    const day = byDate.get(s.date);
    if (!day) return s;
    const found = new Map<string, TimetableSection>();
    for (const e of day.entries) {
      if (!timesOverlap(e.startTime, e.endTime, s.startTime, s.endTime)) continue;
      for (const sec of e.sections) found.set(sec.id, sec);
    }
    const list = [...found.values()];
    if (list.length === 0) return { ...s, dayNumber: day.dayNumber };
    return {
      ...s,
      dayNumber: day.dayNumber,
      section: list.map((x) => x.title).join(" and "),
      sectionFaculty: [...new Set(list.map((x) => x.facultyName).filter((n): n is string => !!n))],
      topic: list.map((x) => x.topic).filter(Boolean).join(" · ") || null,
      ...(viewerUserId && { taughtByMe: list.some((x) => x.facultyUserId === viewerUserId) }),
    };
  });
}
