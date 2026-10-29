/**
 * Shared fixtures for assignments-polls tests: one course with two batches taught by
 * different faculty, students in each, and a temporary storage folder.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { WEEKDAYS, person, setupCourse, slots } from "../fixtures";
import { finishUpload, putPart, startUpload, type StartUpload } from "@/modules/assignments-polls/service/files";
import type { AssignmentInput } from "@/modules/assignments-polls/service/assignments";

/** Points storage at a fresh temporary folder; returns a cleanup function. */
export function tempStorage() {
  const dir = mkdtempSync(join(tmpdir(), "zinny-asgn-"));
  const prev = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  return {
    dir,
    cleanup() {
      if (prev === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function enrol(student: Actor, batchId: string) {
  const { holdSeat } = await import("@/server/services/enrolment");
  const r = await holdSeat(student, { batchId, acknowledgeClash: true });
  if (r.status !== "enrolled") throw new Error(`Expected a free enrolment, got ${r.status}`);
  return r.enrolmentId;
}

/**
 * A course with batch A (taught by Farah) and batch B (taught by Omar), two students in A
 * and one in B. Batches start in 2030, so "now" in tests is passed explicitly.
 */
export async function twoBatches(name = "Assignments U") {
  const ctx = await setupCourse({ name });
  const { createBatch } = await import("@/server/services/batches");
  const omar = await person("Omar Other", "permanent_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id });
  const batchB = await createBatch(ctx.hod, {
    courseId: ctx.course.id,
    name: "Weekday evening",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: 20,
    slots: slots(WEEKDAYS, "18:00", "20:00"),
    faculty: [{ userId: omar.user.id, role: "permanent_faculty" }],
  });
  const farah = await loadActor(ctx.facultyUserId, ctx.uni.id);
  const omarActor = await loadActor(omar.user.id, ctx.uni.id);
  const riya = await ctx.student("Riya Student");
  const kabir = await ctx.student("Kabir Student");
  const zoya = await ctx.student("Zoya Student");
  const riyaEnrolment = await enrol(riya, ctx.batch.id);
  await enrol(kabir, ctx.batch.id);
  await enrol(zoya, batchB.id);
  return { ...ctx, batchA: ctx.batch, batchB, farah, omar: omarActor, riya, kabir, zoya, riyaEnrolment };
}

export type Two = Awaited<ReturnType<typeof twoBatches>>;

/** 2030-11-01 10:00 IST and friends: fixed instants for deadlines. */
export const T = {
  before: new Date("2030-11-10T04:30:00Z"), // 10 Nov 10:00 IST
  dueDate: "2030-11-14",
  dueTime: "23:59",
  due: new Date("2030-11-14T18:29:00Z"), // 14 Nov 23:59 IST
  afterDue: new Date("2030-11-15T05:00:00Z"),
};

export function assignmentInput(courseId: string, over: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    courseId,
    title: "SQL joins worksheet",
    instructionsHtml: "<p>Solve the <strong>five</strong> join questions.</p>",
    dueDate: T.dueDate,
    dueTime: T.dueTime,
    points: 10,
    allowLate: false,
    latePenaltyPct: 0,
    submissionType: "both",
    maxFiles: 3,
    maxFileMb: 10,
    batchIds: "all",
    ...over,
  };
}

/** Uploads a whole file the way the browser does (start, parts, finish) and returns its id. */
export async function upload(actor: Actor, input: Omit<StartUpload, "size" | "fileName"> & { fileName?: string; body?: Buffer | string }) {
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body ?? "%PDF-1.4 test file");
  const { body: _b, fileName, ...rest } = input;
  void _b;
  const started = await startUpload(actor, { ...(rest as StartUpload), fileName: fileName ?? "answer.pdf", size: body.length } as StartUpload);
  for (let i = 0; i < started.parts; i++) await putPart(actor, started.fileId, i, body.subarray(i * started.partBytes, (i + 1) * started.partBytes));
  await finishUpload(actor, started.fileId);
  return started.fileId;
}
