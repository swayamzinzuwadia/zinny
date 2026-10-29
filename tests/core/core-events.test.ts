import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { createBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { cancelHold, confirmPayment, decideSwitch, holdSeat, requestSwitch } from "@/server/services/enrolment";
import { createUniversity } from "@/server/services/support";
import { addPerson, graduate, importPeople, linkParent } from "@/server/services/users";
import { createProgram } from "@/server/services/departments";
import { eventsOfType } from "../helpers/events";
import { grant, makeUser, setupCourse, slots, WEEKDAYS } from "../fixtures";

afterAll(closeDb);

describe("core emits the catalogue events", () => {
  it("enrolment.confirmed for a free enrolment", async () => {
    const { uni, course, batch, student } = await setupCourse({ name: "Free U" });
    const s = await student("Free Student");
    const r = await holdSeat(s, { batchId: batch.id });
    expect(r.status).toBe("enrolled");
    const [e] = await eventsOfType("enrolment.confirmed", uni.id);
    expect(e.payload).toEqual({ enrolmentId: (r as { enrolmentId: string }).enrolmentId, userId: s.userId, courseId: course.id, batchId: batch.id });
    expect(e.actorUserId).toBe(s.userId);
  });

  it("payment.confirmed and enrolment.confirmed when a paid order is confirmed, once", async () => {
    const { uni, course, batch, student } = await setupCourse({ name: "Paid U", pricePaise: 100_000 });
    const s = await student("Paying Student");
    const r = await holdSeat(s, { batchId: batch.id });
    if (r.status !== "held") throw new Error("expected a held seat");
    expect(await eventsOfType("enrolment.confirmed", uni.id)).toHaveLength(0);
    const out = await confirmPayment(uni.id, { orderId: r.orderId, gatewayPaymentId: "pay_1" });
    await confirmPayment(uni.id, { orderId: r.orderId, gatewayPaymentId: "pay_1" }); // replay
    const pay = await eventsOfType("payment.confirmed", uni.id);
    expect(pay).toHaveLength(1);
    expect(pay[0].payload).toEqual({
      orderId: r.orderId,
      userId: s.userId,
      courseId: course.id,
      batchId: batch.id,
      totalPaise: 118_000,
      invoiceNumber: out.invoiceNumber,
    });
    expect(pay[0].actorUserId).toBeNull();
    const enr = await eventsOfType("enrolment.confirmed", uni.id);
    expect(enr.map((e) => e.payload)).toEqual([{ enrolmentId: r.enrolmentId, userId: s.userId, courseId: course.id, batchId: batch.id }]);
  });

  it("no enrolment.confirmed when a late payment has to be refunded", async () => {
    const { uni, batch, student } = await setupCourse({ name: "Refund U", pricePaise: 50_000, seatLimit: 1 });
    const slow = await student("Slow Payer");
    const r = await holdSeat(slow, { batchId: batch.id });
    if (r.status !== "held") throw new Error("expected a held seat");
    await cancelHold(slow, r.enrolmentId);
    const fast = await student("Fast Payer");
    const f = await holdSeat(fast, { batchId: batch.id });
    if (f.status !== "held") throw new Error("expected a held seat");
    await confirmPayment(uni.id, { orderId: f.orderId, gatewayPaymentId: "fast" });
    expect((await confirmPayment(uni.id, { orderId: r.orderId, gatewayPaymentId: "slow" })).status).toBe("refund_due");
    expect((await eventsOfType("enrolment.confirmed", uni.id)).map((e) => e.payload.userId)).toEqual([fast.userId]);
  });

  it("enrolment.switched when the HOD approves a switch, not when they decline", async () => {
    const { uni, hod, course, batch, facultyUserId, student } = await setupCourse({ name: "Switch U" });
    const evening = await createBatch(hod, {
      courseId: course.id,
      name: "Evening",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "18:00", "20:00"),
      faculty: [{ userId: facultyUserId, role: "permanent_faculty" }],
    });
    const s = await student("Switching Student");
    const r = await holdSeat(s, { batchId: batch.id });
    const enrolmentId = (r as { enrolmentId: string }).enrolmentId;
    const first = await requestSwitch(s, { enrolmentId, toBatchId: evening.id });
    await decideSwitch(hod, (first as { requestId: string }).requestId, { approve: false });
    expect(await eventsOfType("enrolment.switched", uni.id)).toHaveLength(0);
    const second = await requestSwitch(s, { enrolmentId, toBatchId: evening.id });
    await decideSwitch(hod, (second as { requestId: string }).requestId, { approve: true });
    const [e] = await eventsOfType("enrolment.switched", uni.id);
    expect(e.payload).toEqual({ enrolmentId, userId: s.userId, courseId: course.id, fromBatchId: batch.id, toBatchId: evening.id });
  });

  it("enrolment.ended for program courses at graduation, but not for a seat that was only held", async () => {
    const { uni, admin, dept, facultyUserId, student } = await setupCourse({ name: "Graduation U" });
    const program = await createProgram(admin, { departmentId: dept.id, name: "BTech" });
    const mk = async (title: string, price: number, start: string) => {
      const c = await createCourse(admin, { departmentId: dept.id, title, pricePaise: price, programId: program.id });
      const b = await createBatch(admin, {
        courseId: c.id,
        name: "Main",
        startDate: "2030-11-04",
        endDate: "2031-03-31",
        seatLimit: 10,
        slots: slots([6], start, `${Number(start.slice(0, 2)) + 1}:00`),
        faculty: [{ userId: facultyUserId, role: "permanent_faculty" }],
      });
      await updateCourse(admin, c.id, { status: "published" });
      return { c, b };
    };
    const free = await mk("Semester 1", 0, "09:00");
    const paid = await mk("Semester 2", 10_000, "12:00");
    const s = await student("Graduating Student");
    const enrolled = await holdSeat(s, { batchId: free.b.id });
    await holdSeat(s, { batchId: paid.b.id }); // held, never paid
    expect(await graduate(admin, s.userId)).toEqual({ endedEnrolments: 2 });
    const ended = await eventsOfType("enrolment.ended", uni.id);
    expect(ended.map((e) => e.payload)).toEqual([
      { enrolmentId: (enrolled as { enrolmentId: string }).enrolmentId, userId: s.userId, courseId: free.c.id, reason: "graduated" },
    ]);
  });

  it("user.invited when a person without a password is added or imported, once per new role", async () => {
    const { uni, admin, dept } = await setupCourse({ name: "Invite U" });
    const userId = await addPerson(admin, { name: "New Teacher", email: "new.teacher@invite.test", role: "permanent_faculty", departmentId: dept.id });
    await importPeople(admin, "name,email,role\nImported Student,imported@invite.test,student", { commit: true });
    await importPeople(admin, "name,email,role\nImported Student,imported@invite.test,student", { commit: true }); // re-import: no new role
    const invited = await eventsOfType("user.invited", uni.id);
    const byEmail = Object.fromEntries(invited.map((e) => [e.payload.email, e.payload]));
    expect(byEmail["new.teacher@invite.test"]).toEqual({ userId, email: "new.teacher@invite.test", name: "New Teacher", role: "permanent_faculty" });
    expect(byEmail["imported@invite.test"]).toMatchObject({ name: "Imported Student", role: "student" });
    expect(invited.filter((e) => e.payload.email === "imported@invite.test")).toHaveLength(1);
  });

  it("user.invited for a linked parent", async () => {
    const { uni, admin, student } = await setupCourse({ name: "Parent U" });
    const s = await student("Kid");
    const parentId = await linkParent(admin, { studentUserId: s.userId, parentEmail: "mum@invite.test", parentName: "Mum" });
    const [e] = (await eventsOfType("user.invited", uni.id)).filter((x) => x.payload.email === "mum@invite.test");
    expect(e.payload).toEqual({ userId: parentId, email: "mum@invite.test", name: "Mum", role: "parent" });
  });

  it("no user.invited for someone who already has a password", async () => {
    const { uni, admin } = await setupCourse({ name: "Existing U" });
    const existing = await makeUser("Has Password");
    await systemDb().update(users).set({ passwordHash: "x" }).where(eq(users.id, existing.id));
    await addPerson(admin, { name: existing.name, email: existing.email, role: "board_owner" });
    expect((await eventsOfType("user.invited", uni.id)).filter((e) => e.payload.email === existing.email)).toHaveLength(0);
  });

  it("user.invited for a new university's admin", async () => {
    const zinny = await makeUser("Zara Zinny");
    await grant(zinny.id, "super_admin");
    const uni = await createUniversity(await loadActor(zinny.id, null), {
      name: "Brand New University",
      slug: `brand-new-${Date.now().toString(36)}`,
      adminName: "Ada Admin",
      adminEmail: `ada.${Date.now().toString(36)}@new.test`,
    });
    const [e] = await eventsOfType("user.invited", uni.id);
    expect(e.payload).toMatchObject({ name: "Ada Admin", role: "institute_admin" });
    expect(e.actorUserId).toBe(zinny.id);
  });
});
