import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { batches, enrolments, notifications, orders, roleAssignments, studentDepartments } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { createBatch, seatsTaken, setSeatLimit } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { browseCatalog, decideEnrolment, holdSeat, listEnrolmentRequests } from "@/server/services/enrolment";
import { setStudentDepartments } from "@/server/services/students";
import { idnJoinRequests, idnSettings } from "@/modules/identity/schema";
import {
  decideJoinRequest,
  findInstituteByCode,
  getJoinSettings,
  joinWithCode,
  listJoinRequests,
  regenerateJoinCode,
  setJoinMode,
} from "@/modules/identity/joining";
import { expectTenantIsolated } from "./helpers/isolation";
import { makeDepartment, makeUser, person, setupCourse, slots } from "./fixtures";

afterAll(() => closeDb());

const taken = (batchId: string) => systemDb().transaction((tx) => seatsTaken(tx, batchId));

/** A university with a second department, its own HOD and a published course there. */
async function twoDepartments() {
  const base = await setupCourse({ name: "Join University" });
  const design = await makeDepartment(base.uni.id, "DES", "Design");
  const designHod = await (await person("Hod Dev", "hod", { universityId: base.uni.id, departmentId: design.id })).actor();
  const designFac = await person("Faculty Dia", "permanent_faculty", { universityId: base.uni.id, departmentId: design.id });
  const designCourse = await createCourse(designHod, { departmentId: design.id, title: "UI Design", pricePaise: 0 });
  const designBatch = await createBatch(designHod, {
    courseId: designCourse.id,
    name: "Evening",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: 10,
    slots: slots([6], "10:00", "12:00"),
    faculty: [{ userId: designFac.user.id, role: "permanent_faculty" }],
  });
  await updateCourse(designHod, designCourse.id, { status: "published" });
  return { ...base, design, designHod, designCourse, designBatch };
}

describe("joining an institute with its code", () => {
  it("makes a code once, finds the institute by it, and a new code retires the old one", async () => {
    const { admin } = await setupCourse();
    const first = await getJoinSettings(admin);
    expect(first.code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await getJoinSettings(admin)).code).toBe(first.code);
    expect((await findInstituteByCode(first.code.toLowerCase()))?.id).toBe(admin.universityId);
    const { code } = await regenerateJoinCode(admin);
    expect(code).not.toBe(first.code);
    expect(await findInstituteByCode(first.code)).toBeNull();
  });

  it("with approval on (the default), sends a request that a HOD accepts into their own department only", async () => {
    const { admin, hod, dept, design, designHod } = await twoDepartments();
    const { code } = await getJoinSettings(admin);
    const learner = await makeUser("Learner Lata");
    const r = await joinWithCode(learner.id, { code, departmentId: dept.id, message: "Roll no. 12" });
    if (r.status !== "requested") throw new Error("expected a request");

    // The Design HOD doesn't see a Computer Science request; the CS HOD and the admin do.
    expect(await listJoinRequests(designHod)).toHaveLength(0);
    expect((await listJoinRequests(hod)).map((q) => q.userId)).toEqual([learner.id]);
    expect((await listJoinRequests(admin)).map((q) => q.userId)).toContain(learner.id);

    // A HOD can't put the student in someone else's department, and accepting needs a department.
    await expect(decideJoinRequest(hod, r.requestId, { accept: true, departmentIds: [design.id] })).rejects.toThrow();
    await expect(decideJoinRequest(hod, r.requestId, { accept: true, departmentIds: [] })).rejects.toThrow(/department/);
    await decideJoinRequest(hod, r.requestId, { accept: true, departmentIds: [dept.id] });

    const roles = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, learner.id));
    expect(roles.map((x) => x.role)).toEqual(["student"]);
    const placed = await systemDb().select().from(studentDepartments).where(eq(studentDepartments.userId, learner.id));
    expect(placed.map((p) => p.departmentId)).toEqual([dept.id]);
    await expect(decideJoinRequest(admin, r.requestId, { accept: false, departmentIds: [] })).rejects.toThrow(/already/);

    // Everyone who was asked to answer now reads who did, instead of "accept or decline".
    const asked = await systemDb()
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "join.requested"), inArray(notifications.userId, [admin.userId, hod.userId])));
    expect(asked.length).toBeGreaterThanOrEqual(2);
    for (const n of asked.filter((x) => (x.data as { requestId?: string }).requestId === r.requestId)) {
      expect(n.body).toBe(`Accepted by ${hod.name}.`);
      expect(n.readAt).not.toBeNull();
    }
  });

  it("a declined request gives no role; asking again while one waits reuses it", async () => {
    const { admin } = await setupCourse();
    const { code } = await getJoinSettings(admin);
    const learner = await makeUser("Learner Laxmi");
    const a = await joinWithCode(learner.id, { code });
    const b = await joinWithCode(learner.id, { code });
    if (a.status !== "requested" || b.status !== "requested") throw new Error("expected requests");
    expect(b.requestId).toBe(a.requestId);
    await decideJoinRequest(admin, a.requestId, { accept: false, departmentIds: [], note: "Not enrolled here" });
    const [req] = await systemDb().select().from(idnJoinRequests).where(eq(idnJoinRequests.userId, learner.id));
    expect(req).toMatchObject({ status: "rejected", decisionNote: "Not enrolled here" });
    expect(await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, learner.id))).toHaveLength(0);
  });

  it("with instant joining, the code makes a student straight away, in the department they picked", async () => {
    const { admin, dept } = await setupCourse();
    await setJoinMode(admin, "instant");
    const { code } = await getJoinSettings(admin);
    const learner = await makeUser("Learner Lina");
    expect((await joinWithCode(learner.id, { code, departmentId: dept.id })).status).toBe("joined");
    const placed = await systemDb().select().from(studentDepartments).where(eq(studentDepartments.userId, learner.id));
    expect(placed.map((p) => p.departmentId)).toEqual([dept.id]);
  });

  it("an unknown code is refused", async () => {
    const learner = await makeUser("Learner Lost");
    await expect(joinWithCode(learner.id, { code: "ZZZZZZ" })).rejects.toThrow(/can't find/);
  });
});

describe("students only see their departments' courses", () => {
  it("a student in no department sees nothing; in one, only its courses; and can't enrol elsewhere", async () => {
    const { admin, uni, dept, course, designBatch } = await twoDepartments();
    // Added by hand (not through the fixtures, which place test students everywhere): in no department.
    const s = await makeUser("Student Sam");
    await systemDb().insert(roleAssignments).values({ userId: s.id, role: "student", scopeType: "university", universityId: uni.id });
    expect(await browseCatalog(await loadActor(s.id, uni.id))).toEqual([]);

    await setStudentDepartments(admin, s.id, [dept.id]);
    const student = await loadActor(s.id, uni.id);
    expect((await browseCatalog(student)).map((c) => c.id)).toEqual([course.id]);
    await expect(holdSeat(student, { batchId: designBatch.id })).rejects.toThrow(/isn't open to you/);
    // Staff are never limited.
    expect((await browseCatalog(admin)).length).toBe(2);
  });
});

describe("faculty accept each student", () => {
  async function approvalBatch(pricePaise = 0) {
    const ctx = await setupCourse({ name: "Approval University", pricePaise, seatLimit: 1 });
    await systemDb().update(batches).set({ approvalRequired: true }).where(eq(batches.id, ctx.batch.id));
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    return { ...ctx, faculty };
  }

  it("a request holds no seat until faculty accept it; a free course then enrols the student", async () => {
    const { batch, faculty, student } = await approvalBatch();
    const s = await student("Student Sana");
    expect((await holdSeat(s, { batchId: batch.id })).status).toBe("requested");
    expect(await taken(batch.id)).toBe(0);

    const waiting = await listEnrolmentRequests(faculty, { batchId: batch.id });
    expect(waiting.map((w) => w.student.name)).toEqual(["Student Sana"]);
    expect((await decideEnrolment(faculty, waiting[0].enrolmentId, true)).status).toBe("enrolled");
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, waiting[0].enrolmentId));
    expect(e.status).toBe("active");
    // The faculty member's "accept or decline" now says it was done.
    const [asked] = await systemDb()
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, "enrolment.requested"), eq(notifications.userId, faculty.userId)));
    expect(asked).toMatchObject({ body: `Accepted by ${faculty.name}.` });
    expect(asked.readAt).not.toBeNull();
  });

  it("accepting enrols the student even when the course has a price: no checkout", async () => {
    const { batch, faculty, student } = await approvalBatch(50_000);
    const s = await student("Student Sid");
    const r = await holdSeat(s, { batchId: batch.id });
    if (r.status !== "requested") throw new Error("expected a request");
    expect((await decideEnrolment(faculty, r.enrolmentId, true, "See you on Monday")).status).toBe("enrolled");
    expect(await taken(batch.id)).toBe(1);
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, r.enrolmentId));
    expect(e).toMatchObject({ status: "active", decisionNote: "See you on Monday" });
    expect(await systemDb().select().from(orders).where(eq(orders.userId, s.userId))).toEqual([]);

    // That was the only seat: nobody else gets it.
    await expect(holdSeat(await student("Student Om"), { batchId: batch.id })).rejects.toThrow(/full/);
  });

  it("faculty of another batch can't answer; a declined student is told why and holds nothing", async () => {
    const { batch, student, uni, dept } = await approvalBatch();
    const outsider = await (await person("Faculty Out", "permanent_faculty", { universityId: uni.id, departmentId: dept.id })).actor();
    const s = await student("Student Tara");
    const r = await holdSeat(s, { batchId: batch.id });
    if (r.status !== "requested") throw new Error("expected a request");
    await expect(decideEnrolment(outsider, r.enrolmentId, true)).rejects.toThrow();

    const [hodRow] = await systemDb()
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.universityId, uni.id), eq(roleAssignments.role, "hod")));
    const hod = await loadActor(hodRow.userId, uni.id);
    expect((await decideEnrolment(hod, r.enrolmentId, false, "Batch is for seniors")).status).toBe("declined");
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, r.enrolmentId));
    // Declined is stored as cancelled with the decision on it.
    expect(e).toMatchObject({ status: "cancelled", decisionNote: "Batch is for seniors" });
    expect(e.decidedAt).not.toBeNull();
    expect(await taken(batch.id)).toBe(0);
  });
});

describe("seat limits change any time", () => {
  it("go up or down, even after the batch ended, but never below the seats taken", async () => {
    const { hod, batch, student } = await setupCourse({ seatLimit: 2 });
    await holdSeat(await student("Student Uma"), { batchId: batch.id });
    await expect(setSeatLimit(hod, batch.id, 0)).rejects.toThrow(/at least 1/);
    expect((await setSeatLimit(hod, batch.id, 1)).seatLimit).toBe(1);
    expect((await setSeatLimit(hod, batch.id, 40)).seatLimit).toBe(40);
    await systemDb().update(batches).set({ startDate: "2020-01-01", endDate: "2020-02-01" }).where(eq(batches.id, batch.id));
    expect((await setSeatLimit(hod, batch.id, 5)).seatLimit).toBe(5);
  });

  it("faculty can't change seats", async () => {
    const { batch, facultyUserId, uni } = await setupCourse();
    await expect(setSeatLimit(await loadActor(facultyUserId, uni.id), batch.id, 50)).rejects.toThrow();
  });
});

describe("new tables are isolated per university", () => {
  it("idn_join_requests", async () => {
    const u = await makeUser("Iso Joiner");
    await expectTenantIsolated(idnJoinRequests, (uni) => ({ universityId: uni.id, userId: u.id, name: u.name, email: u.email }));
  });

  it("student_departments", async () => {
    const u = await makeUser("Iso Student");
    await expectTenantIsolated(studentDepartments, async (uni) => ({
      universityId: uni.id,
      userId: u.id,
      departmentId: (await makeDepartment(uni.id, `D${Math.random().toString(36).slice(2, 6).toUpperCase()}`, "Iso")).id,
    }));
  });

  it("idn_settings keeps the joining code per institute", async () => {
    const { admin } = await setupCourse();
    await getJoinSettings(admin);
    const [row] = await systemDb().select().from(idnSettings).where(eq(idnSettings.universityId, admin.universityId!));
    expect(row.joinCode).toBeTruthy();
  });
});
