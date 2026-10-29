/** Links core pages share with modules. */

/**
 * A student's Join button for one class. The route is built by live-classes; it records
 * the join and redirects to the meeting (the class's own link, or else the batch's), so link
 * to it with a plain <a> (never <Link>, which would prefetch it). Pass the class's start
 * time so a batch with two classes in a day joins the right one.
 */
export function joinPath(uni: string, batchId: string, date: string, startTime?: string) {
  const start = startTime?.slice(0, 5);
  return `/${uni}/learn/join/${batchId}/${date}${start && /^\d{2}:\d{2}$/.test(start) ? `?start=${start}` : ""}`;
}

/** Students may join from this many minutes before the start until the end (live-classes' rule). */
export const JOIN_OPENS_MINUTES = 15;

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Whether a class's join window is open: today, from 15 minutes before the start until the end. */
export function joinWindowOpen(s: { date: string; startTime: string; endTime: string }, today: string, nowMinutes: number) {
  return s.date === today && nowMinutes >= toMinutes(s.startTime) - JOIN_OPENS_MINUTES && nowMinutes < toMinutes(s.endTime);
}
