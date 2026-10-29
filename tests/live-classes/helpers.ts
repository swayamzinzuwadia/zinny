/**
 * Fixtures for live-classes tests. `setupCourse()` gives a batch that runs Mon–Fri
 * 09:00–11:00 (Asia/Kolkata) from Monday 2030-11-04, so every test picks its own "now".
 */
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { updateBatch } from "@/server/services/batches";
import { decideSwitch, holdSeat, requestSwitch } from "@/server/services/enrolment";
import { grant, makeUser, setupCourse } from "../fixtures";

export const MON = "2030-11-04";
export const TUE = "2030-11-05";
export const WED = "2030-11-06";
export const THU = "2030-11-07";
export const FRI = "2030-11-08";
export const MEET = "https://meet.google.com/live-test";

/** An instant from an IST wall-clock time: ist("2030-11-04", "08:50"). */
export function ist(date: string, time: string, seconds = 0): Date {
  const [h, m] = time.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, seconds) - 330 * 60_000);
}

export async function enrol(student: Actor, batchId: string) {
  const r = await holdSeat(student, { batchId, acknowledgeClash: true });
  if (r.status !== "enrolled") throw new Error(`Expected a free enrolment, got ${r.status}`);
  return r.enrolmentId;
}

/** A course with one batch (with a meeting link), its faculty as an actor, and enrolled students. */
export async function liveSetup(name: string, opts: { students?: number; meetingUrl?: string | null } = {}) {
  const ctx = await setupCourse({ name });
  if (opts.meetingUrl !== null) await updateBatch(ctx.hod, ctx.batch.id, { meetingUrl: opts.meetingUrl ?? MEET });
  const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
  const students: Actor[] = [];
  const enrolments: string[] = [];
  for (let i = 0; i < (opts.students ?? 2); i++) {
    const s = await ctx.student(`Student ${String.fromCharCode(65 + i)}`);
    enrolments.push(await enrol(s, ctx.batch.id));
    students.push(s);
  }
  return { ...ctx, faculty, students, enrolments };
}

/** A visiting faculty member on a batch whose access ends at `endsAt`. */
export async function visitingFaculty(universityId: string, departmentId: string, batchId: string, endsAt: Date) {
  const u = await makeUser("Visiting Vik");
  await grant(u.id, "visiting_faculty", { universityId, departmentId }, endsAt);
  await grant(u.id, "visiting_faculty", { universityId, batchId }, endsAt);
  return loadActor(u.id, universityId);
}

/** Moves a student to another batch of the same course (request, then the HOD approves). */
export async function switchBatch(student: Actor, hod: Actor, enrolmentId: string, toBatchId: string) {
  const req = await requestSwitch(student, { enrolmentId, toBatchId, acknowledgeClash: true });
  if (req.status !== "requested") throw new Error(`Expected a switch request, got ${req.status}`);
  const d = await decideSwitch(hod, req.requestId, { approve: true });
  if (d.status !== "approved") throw new Error(`Expected the switch to be approved, got ${d.status}`);
}
