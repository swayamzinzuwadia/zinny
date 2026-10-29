/**
 * A small university for gamification tests: two departments (CS with two batches of one
 * course, Marketing with one), their HODs and faculty, and a helper to enrol students
 * and send events the way other modules would.
 */
import { randomUUID } from "node:crypto";
import type { EventMap, EventType } from "@/contracts/events";
import { loadActor } from "@/server/actor";
import { emit, systemActorFor, withTenant } from "@/server/core";
import gamification from "@/modules/gamification";
import { drainEvents } from "../helpers/events";
import { person, setupCourse, slots, uniqueCode, WEEKDAYS } from "../fixtures";

export async function world(name = "Gamification University") {
  const ctx = await setupCourse({ name });
  const { createDepartment } = await import("@/server/services/departments");
  const { createCourse, updateCourse } = await import("@/server/services/courses");
  const { createBatch } = await import("@/server/services/batches");
  const { holdSeat } = await import("@/server/services/enrolment");

  const mkt = await createDepartment(ctx.admin, { code: uniqueCode("M"), name: "Marketing" });
  const hodMkt = await (await person("Hod Mehul", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
  const neel = await person("Faculty Neel", "permanent_faculty", { universityId: ctx.uni.id, departmentId: mkt.id });
  const course2 = await createCourse(hodMkt, { departmentId: mkt.id, title: "Digital Marketing", pricePaise: 0 });
  const batch2 = await createBatch(hodMkt, {
    courseId: course2.id,
    name: "Evening",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: 20,
    slots: slots([2, 4], "19:00", "21:00"),
    faculty: [{ userId: neel.user.id, role: "permanent_faculty" }],
  });
  await updateCourse(hodMkt, course2.id, { status: "published" });
  const batchB = await createBatch(ctx.hod, {
    courseId: ctx.course.id,
    name: "Weekday evening",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: 20,
    slots: slots(WEEKDAYS, "17:00", "18:00"),
    faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
  });

  const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
  const facultyMkt = await loadActor(neel.user.id, ctx.uni.id);
  const sys = systemActorFor(ctx.uni.id);

  /** A student enrolled (free) in the given batches. */
  async function enrolled(studentName: string, batchIds: string[]) {
    const actor = await ctx.student(studentName);
    const enrolments: Record<string, string> = {};
    for (const b of batchIds) {
      const r = await holdSeat(actor, { batchId: b, acknowledgeClash: true });
      if (r.status !== "enrolled") throw new Error(`Expected a free enrolment, got ${r.status}`);
      enrolments[b] = r.enrolmentId;
    }
    return { actor, id: actor.userId, enrolments };
  }

  /** Emit an event as another module would (system actor of this university). */
  async function send<T extends EventType>(type: T, payload: EventMap[T]): Promise<string> {
    return withTenant(sys, (tx) => emit(tx, sys, type, payload));
  }

  /** Deliver this university's pending events to gamification's handlers only. */
  const drain = () => drainEvents({ handlers: gamification.eventHandlers!, universityId: ctx.uni.id });

  return { ...ctx, mkt, hodMkt, course2, batch2, batchB, faculty, facultyMkt, sys, enrolled, send, drain };
}

export type World = Awaited<ReturnType<typeof world>>;

/** A fresh id for lessons, tests and assignments that only exist in event payloads. */
export const fakeId = () => randomUUID();
