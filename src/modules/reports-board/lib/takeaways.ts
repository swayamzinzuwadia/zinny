/**
 * The one-line takeaway under each Insights chart. Pure, so every branch is tested.
 * Plain sentence case, active voice, no exclamation marks.
 */
import { formatHours, formatMoney, formatNumber, formatPercent } from "./format";

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export type WeekPoint = { start: string; label: string; count: number; current: boolean };

export function enrolmentsTakeaway(weeks: WeekPoint[]): string {
  const total = weeks.reduce((n, w) => n + w.count, 0);
  if (total === 0) return "No enrolments in the last 12 weeks.";
  const now = weeks.find((w) => w.current) ?? weeks[weeks.length - 1];
  const prev = weeks[weeks.indexOf(now) - 1];
  const head = `${plural(now.count, "enrolment")} this week`;
  const busiest = Math.max(...weeks.map((w) => w.count));
  if (now.count > 0 && now.count === busiest && weeks.filter((w) => w.count === busiest).length === 1) {
    return `${head}, the most in 12 weeks. ${plural(total, "enrolment")} in all.`;
  }
  if (!prev) return `${head}. ${plural(total, "enrolment")} in the last 12 weeks.`;
  if (now.count > prev.count) return `${head}, up from ${formatNumber(prev.count)} last week.`;
  if (now.count < prev.count) return `${head}, down from ${formatNumber(prev.count)} last week.`;
  return `${head}, the same as last week.`;
}

export type CourseCompletion = { courseId: string; title: string; department: string; enrolled: number; completed: number; learning: number; rate: number };

export function completionTakeaway(courses: CourseCompletion[]): string {
  const enrolled = courses.reduce((n, c) => n + c.enrolled, 0);
  const completed = courses.reduce((n, c) => n + c.completed, 0);
  const learning = courses.reduce((n, c) => n + c.learning, 0);
  if (enrolled === 0) return "Nobody has enrolled yet, so there are no completions to show.";
  if (completed === 0) return `No learner has completed a course yet. ${plural(learning, "learner is", "learners are")} still learning.`;
  const best = [...courses].sort((a, b) => b.rate - a.rate || b.enrolled - a.enrolled)[0];
  return `${best.title} leads at ${formatPercent(best.rate)} (${formatNumber(best.completed)} of ${formatNumber(best.enrolled)}). ${formatPercent((completed / enrolled) * 100)} complete across all courses.`;
}

export type MonthPoint = { start: string; label: string; paise: number; current: boolean };

export function revenueMonthTakeaway(months: MonthPoint[]): string {
  const total = months.reduce((n, m) => n + m.paise, 0);
  if (total === 0) return "No revenue in the last 12 months.";
  const now = months.find((m) => m.current) ?? months[months.length - 1];
  const prev = months[months.indexOf(now) - 1];
  const head = `${formatMoney(now.paise)} so far this month`;
  if (!prev || prev.paise === 0) return `${head}, against nothing last month. ${formatMoney(total)} in the last 12 months.`;
  const change = ((now.paise - prev.paise) / prev.paise) * 100;
  if (Math.abs(change) < 0.5) return `${head}, level with last month's ${formatMoney(prev.paise)}.`;
  return `${head}, ${formatPercent(Math.abs(change))} ${change > 0 ? "up on" : "down on"} last month's ${formatMoney(prev.paise)}.`;
}

export type CourseRevenue = { courseId: string; title: string; paise: number };

export function revenueCourseTakeaway(courses: CourseRevenue[]): string {
  const total = courses.reduce((n, c) => n + c.paise, 0);
  if (total <= 0) return "No course has earned revenue in the last 12 months.";
  const top = [...courses].sort((a, b) => b.paise - a.paise)[0];
  if (courses.filter((c) => c.paise > 0).length === 1) return `All revenue in the last 12 months came from ${top.title}: ${formatMoney(top.paise)}.`;
  return `${top.title} earns the most: ${formatMoney(top.paise)}, ${formatPercent((top.paise / total) * 100)} of the last 12 months.`;
}

export type FacultyLoad = { userId: string; name: string; batches: number; lastWeek: number; thisWeek: number; nextWeek: number };

export function facultyTakeaway(load: FacultyLoad[]): string {
  if (load.length === 0) return "No faculty are assigned to batches yet.";
  const teaching = load.filter((f) => f.thisWeek > 0);
  if (teaching.length === 0) {
    const next = load.reduce((n, f) => n + f.nextWeek, 0);
    return next > 0 ? `No classes are scheduled this week. Next week has ${formatHours(next)} of teaching.` : "No classes are scheduled this week or next.";
  }
  const top = [...teaching].sort((a, b) => b.thisWeek - a.thisWeek || a.name.localeCompare(b.name))[0];
  const rest = teaching.length - 1;
  const tail = rest > 0 ? ` ${plural(rest, "other faculty member teaches", "other faculty members teach")} this week.` : "";
  return `${top.name} teaches the most this week: ${formatHours(top.thisWeek)} across ${plural(top.batches, "batch", "batches")}.${tail}`;
}

export type BatchFill = { batchId: string; course: string; batch: string; taken: number; held: number; limit: number; fill: number; startsOn: string | null };

export function batchFillTakeaway(batches: BatchFill[]): string {
  if (batches.length === 0) return "No batches are running or open for enrolment.";
  const full = batches.filter((b) => b.taken >= b.limit);
  const nearly = batches.filter((b) => b.taken < b.limit && b.fill >= 80);
  const name = (b: BatchFill) => `${b.course} · ${b.batch}`;
  if (full.length > 0) {
    const first = full.length === 1 ? `${name(full[0])} is full` : `${plural(full.length, "batch is", "batches are")} full`;
    return nearly.length ? `${first}, and ${plural(nearly.length, "more is", "more are")} at least 80% full.` : `${first}. Every other batch has seats left.`;
  }
  const fullest = [...batches].sort((a, b) => b.fill - a.fill)[0];
  if (fullest.taken === 0) return "No seats are taken yet in any running or open batch.";
  return `Every batch has seats left. The fullest is ${name(fullest)} at ${formatPercent(fullest.fill)} (${fullest.taken} of ${fullest.limit}).`;
}
