/** Shared set-up for the certificates tests. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { loadActor } from "@/server/actor";
import { markEnrolmentCompleted } from "@/server/core";
import { holdSeat } from "@/server/services/enrolment";
import { updateCourse } from "@/server/services/courses";
import { drainEvents } from "../helpers/events";
import { makeDepartment, person, setupCourse, uniqueCode } from "../fixtures";

/** Points storage() at a temporary folder for this test file. */
export function useTempStorage() {
  let dir = "";
  const before = process.env.STORAGE_DIR;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zinny-cert-"));
    process.env.STORAGE_DIR = dir;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  });
}

/**
 * A university with a published course (free), its HOD, faculty and admin, plus helpers to
 * enrol students and complete them. Also a second department with its own HOD.
 */
export async function certWorld(name = "Cert University") {
  const w = await setupCourse({ name });
  const faculty = await loadActor(w.facultyUserId, w.uni.id);
  const otherDept = await makeDepartment(w.uni.id, uniqueCode("M"), "Marketing");
  const otherHod = await (await person("Other Hod", "hod", { universityId: w.uni.id, departmentId: otherDept.id })).actor();
  const board = await (await person("Board Bina", "board_owner", { universityId: w.uni.id })).actor();

  async function enrolled(studentName: string) {
    const actor = await w.student(studentName);
    const r = await holdSeat(actor, { batchId: w.batch.id });
    if (r.status !== "enrolled") throw new Error(`expected a free enrolment, got ${r.status}`);
    return { actor, enrolmentId: r.enrolmentId };
  }

  /** Marks the enrolment complete through core (emits enrolment.completed) and delivers events. */
  async function complete(enrolmentId: string) {
    await markEnrolmentCompleted(w.admin, enrolmentId);
    await drainEvents();
  }

  async function setCertificates(on: boolean) {
    await updateCourse(w.hod, w.course.id, { certificateEnabled: on });
  }

  return { ...w, faculty, otherDept, otherHod, board, enrolled, complete, setCertificates };
}
