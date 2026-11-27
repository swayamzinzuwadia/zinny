/** When to remind about a licence ending. Pure, so the overview, the admin banner and the tests agree. */

/** Days before the end date at which the reminder gets more urgent. */
export const REMINDER_DAYS = [30, 14, 7, 1] as const;

export type ReminderLevel = { threshold: 30 | 14 | 7 | 1 | 0; ended: boolean; urgent: boolean };

/**
 * Null while the end is more than 30 days away. From 30 days the reminder shows; it turns
 * urgent at 7 days and 1 day, and stays (as "ended") once the date has passed.
 */
export function reminderLevel(daysLeft: number | null | undefined): ReminderLevel | null {
  if (daysLeft === null || daysLeft === undefined || daysLeft > 30) return null;
  if (daysLeft < 0) return { threshold: 0, ended: true, urgent: true };
  const threshold = ([1, 7, 14, 30] as const).find((t) => daysLeft <= t) ?? 30;
  return { threshold, ended: false, urgent: threshold <= 7 };
}

/** "ends today", "ends tomorrow", "12 days left", "ended 3 days ago". */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft < 0) return `ended ${Math.abs(daysLeft)} day${daysLeft === -1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "ends today";
  if (daysLeft === 1) return "ends tomorrow";
  return `${daysLeft} days left`;
}
