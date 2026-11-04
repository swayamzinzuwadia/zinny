/**
 * Display helpers for a course's recorded batch, where marketplace buyers sit. It has no timetable,
 * no seat limit and placeholder dates (see RECORDED in services/batches.ts), so screens show it as
 * "Recorded lessons" with no dates or status rather than as a class the institute runs.
 */
export const RECORDED_BATCH_LABEL = "Recorded lessons";

/** The recorded batch's placeholder dates: 1 Jan 2000 to 31 Dec 2099. */
export function isRecordedSpan(startDate: string, endDate: string) {
  return startDate <= "2000-01-01" && endDate >= "2099-12-31";
}

/** True for the recorded batch, from its flag or, where only dates are at hand, its placeholder dates. */
export function isRecordedBatch(b: { recorded?: boolean | null; startDate?: string | null; endDate?: string | null }) {
  return !!b.recorded || (!!b.startDate && !!b.endDate && isRecordedSpan(b.startDate, b.endDate));
}

/** A batch's name as people should read it. */
export function batchLabel(b: { name: string; recorded?: boolean | null; startDate?: string | null; endDate?: string | null }) {
  return isRecordedBatch(b) ? RECORDED_BATCH_LABEL : b.name;
}
