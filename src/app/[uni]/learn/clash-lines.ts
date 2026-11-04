import { weekdayLabel } from "@/server/lib/dates";
import type { Clash } from "@/server/services/schedule";

/**
 * The batch picker's clash warning, one line per clashing batch and time instead of one
 * per day: "Data Analytics (Weekday morning), Mon to Fri, 9 am–11 am".
 */
export function clashLines(clashes: Clash[]): string[] {
  const groups = new Map<string, { label: string; time: string; days: number[] }>();
  for (const c of clashes) {
    // `when` is "Mon 9 am–11 am": the day, then the time.
    const time = c.when.slice(c.when.indexOf(" ") + 1);
    const key = `${c.batchId} ${time}`;
    const g = groups.get(key) ?? { label: `${c.courseTitle} (${c.batchName})`, time, days: [] };
    g.days.push(c.weekday);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const days = [...new Set(g.days)].sort((a, b) => a - b);
    const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    const dayText =
      consecutive && days.length > 2
        ? `${weekdayLabel(days[0])} to ${weekdayLabel(days[days.length - 1])}`
        : days.map(weekdayLabel).join(days.length === 2 ? " and " : ", ");
    return `${g.label}, ${dayText}, ${g.time}`;
  });
}
