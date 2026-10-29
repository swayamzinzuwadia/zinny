/**
 * Links into live-classes pages. Join and start links have side effects, so render them
 * as a plain <a> (join) or a POST form (start), never as a prefetching <Link>.
 */
import { hhmm } from "./time";

/** The student's join link for one class. `start` picks a class when a batch has two on one day. */
export function joinHref(uni: string, batchId: string, date: string, start?: string | null) {
  const base = `/${uni}/learn/join/${batchId}/${date}`;
  return start ? `${base}?start=${hhmm(start)}` : base;
}

export function attendanceHref(uni: string, batchId: string) {
  return `/${uni}/admin/products/batches/${batchId}/attendance`;
}

/** The attendance register of one class. */
export function registerHref(uni: string, batchId: string, date: string, start?: string | null) {
  const base = `${attendanceHref(uni, batchId)}/${date}`;
  return start ? `${base}?start=${hhmm(start)}` : base;
}

/** POST target of the "Start class" form (records the start, then opens the meeting). */
export function startHref(uni: string, batchId: string, date: string) {
  return `${attendanceHref(uni, batchId)}/${date}/start`;
}

export function learnerTabHref(uni: string, enrolmentId: string) {
  return `/${uni}/learn/my/${enrolmentId}?tab=live`;
}
