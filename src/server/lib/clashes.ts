import { weekdayLabel } from "./dates";

/** What findClashes() reports (src/server/services/schedule.ts), repeated here so this file stays free of server code. */
type ClashLike = { batchId: string; batchName: string; courseTitle: string; weekday: number; when: string; date?: string };

type Group = { label: string; course: string; batch: string; time: string; days: number[]; dated: boolean };

function dayText(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return consecutive && sorted.length > 2
    ? `${weekdayLabel(sorted[0])} to ${weekdayLabel(sorted[sorted.length - 1])}`
    : sorted.map(weekdayLabel).join(sorted.length === 2 ? " and " : ", ");
}

/** One entry per clashing batch and time: weekly clashes put their days together, one-off clashes keep their date. */
function groups(clashes: ClashLike[]): Group[] {
  const out = new Map<string, Group>();
  for (const c of clashes) {
    const base = { label: `${c.courseTitle} (${c.batchName})`, course: c.courseTitle, batch: c.batchName };
    if (c.date) {
      // `when` is "Sat, 21 Nov, 2 pm–4 pm": already says everything.
      out.set(`${c.batchId} ${c.when}`, { ...base, time: c.when, days: [], dated: true });
      continue;
    }
    // `when` is "Mon 9 am–11 am": the day, then the time.
    const time = c.when.slice(c.when.indexOf(" ") + 1);
    const key = `${c.batchId} ${time}`;
    const g = out.get(key) ?? { ...base, time, days: [], dated: false };
    g.days.push(c.weekday);
    out.set(key, g);
  }
  return [...out.values()];
}

/**
 * The batch picker's clash warning, one line per clashing batch and time instead of one
 * per day: "Data Analytics (Weekday morning), Mon to Fri, 9 am–11 am".
 */
export function clashLines(clashes: ClashLike[]): string[] {
  return groups(clashes).map((g) => (g.dated ? `${g.label}, ${g.time}` : `${g.label}, ${dayText(g.days)}, ${g.time}`));
}

/** "A", "A and B", "A, B and C". */
function listOf(parts: string[]) {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The warning in one sentence, naming each batch and when they meet at the same time:
 * "This batch clashes with Data Analytics – Weekday morning on Mon to Fri, 9 am–11 am."
 * `subject` is who or what clashes ("This batch", "Riya's place in Weekend").
 */
export function clashSentence(clashes: ClashLike[], subject = "This batch"): string {
  if (clashes.length === 0) return "";
  const byBatch = new Map<string, { name: string; times: string[] }>();
  for (const g of groups(clashes)) {
    const name = `${g.course} – ${g.batch}`;
    const entry = byBatch.get(name) ?? { name, times: [] };
    entry.times.push(g.dated ? g.time : `${dayText(g.days)}, ${g.time}`);
    byBatch.set(name, entry);
  }
  const parts = [...byBatch.values()].map((b) => `${b.name} on ${listOf(b.times)}`);
  return `${subject} clashes with ${listOf(parts)}.`;
}
