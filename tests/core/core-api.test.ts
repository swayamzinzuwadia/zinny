import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments, orders, roleAssignments, universities } from "@/db/schema";
import * as core from "@/server/core";
import { loadActor, systemActorFor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { holdSeat } from "@/server/services/enrolment";
import { eventsOfType } from "../helpers/events";
import { grant, makeDepartment, makeUniversity, makeUser, person, setupCourse } from "../fixtures";

afterAll(closeDb);

const CONTRACT_EXPORTS = [
  "withTenant", "audit", "emit", "systemActorFor",
  "assertCan", "can", "reach", "hasRole",
  "universityLite", "todayFor", "peopleLite",
  "getCourseLite", "courseTarget", "batchLite", "listCourseBatches", "facultyBatchIds",
  "batchStudentIds", "studentEnrolments", "enrolmentById", "markEnrolmentCompleted",
  "scheduledBatches", "expandSessions", "studentTimetable",
  "notify", "hodsOf", "storage", "sendEmail", "sendSms", "gateway",
  "orderForCheckout", "confirmPayment", "failPayment", "holdSeat", "markOrderRefunded", "orderUniversity",
  "listUniversities", "createUniversity", "updateUniversity", "enterSupportMode", "exitSupportMode", "supportTrail",
  "grantPlatformRole", "revokePlatformRole", "assertPlatform", "canPlatform",
];

describe("contracts section 8: the core API facade", () => {
  it("exports exactly the listed functions", () => {
    const fns = Object.entries(core).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(fns).toEqual([...CONTRACT_EXPORTS].sort());
  });
});

let ctx: Awaited<ReturnType<typeof setupCourse>>;
let student: Actor;
let enrolmentId: string;

beforeAll(async () => {
  ctx = await setupCourse({ name: "Core API U" });
  student = await ctx.student("Core Api Student");
  const r = await holdSeat(student, { batchId: ctx.batch.id });
  enrolmentId = (r as { enrolmentId: string }).enrolmentId;
});

describe("context and lookups", () => {
  it("universityLite and todayFor describe the tenant's university", async () => {
    const u = await core.withTenant(ctx.admin, (tx) => core.universityLite(tx));
    expect(u).toMatchObject({ id: ctx.uni.id, slug: ctx.uni.slug, name: "Core API U", timezone: "Asia/Kolkata", gstin: "27AAAAA0000A1Z5" });
    const today = await core.withTenant(ctx.admin, (tx) => core.todayFor(tx));
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("peopleLite returns people in the order asked and skips other universities' people", async () => {
    const outsider = await makeUser("Outsider");
    await grant(outsider.id, "student", { universityId: (await makeUniversity("Other U")).id });
    const rows = await core.withTenant(ctx.admin, (tx) => core.peopleLite(tx, [student.userId, outsider.id, ctx.admin.userId, student.userId]));
    expect(rows.map((r) => r.id)).toEqual([student.userId, ctx.admin.userId]);
    expect(rows[0]).toEqual({ id: student.userId, name: "Core Api Student", email: student.email });
  });

  it("getCourseLite, batchLite and listCourseBatches", async () => {
    const c = await core.withTenant(ctx.admin, (tx) => core.getCourseLite(tx, ctx.course.id));
    expect(c).toEqual({
      id: ctx.course.id,
      title: "Data Analytics",
      departmentId: ctx.dept.id,
      programId: null,
      status: "published",
      certificateEnabled: true,
      pricePaise: 0,
    });
    const b = await core.withTenant(ctx.admin, (tx) => core.batchLite(tx, ctx.batch.id));
    expect(b).toMatchObject({ id: ctx.batch.id, courseId: ctx.course.id, name: "Weekday morning", seatLimit: 20, status: "open", meetingUrl: null });
    expect(b.target).toEqual({ universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: [ctx.batch.id] });
    const list = await core.withTenant(ctx.admin, (tx) => core.listCourseBatches(tx, ctx.course.id));
    expect(list.map((x) => x.id)).toEqual([ctx.batch.id]);
    const t = await core.withTenant(ctx.admin, (tx) => core.courseTarget(tx, ctx.uni.id, ctx.course.id));
    expect(t).toEqual({ universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: [ctx.batch.id] });
  });

  it("lookups across universities find nothing", async () => {
    const other = await setupCourse({ name: "Lookup Other U" });
    await expect(core.withTenant(ctx.admin, (tx) => core.getCourseLite(tx, other.course.id))).rejects.toThrow(/Course not found/);
    await expect(core.withTenant(ctx.admin, (tx) => core.batchLite(tx, other.batch.id))).rejects.toThrow(/Batch not found/);
    await expect(core.withTenant(ctx.admin, (tx) => core.enrolmentById(tx, enrolmentId))).resolves.toBeTruthy();
    await expect(core.withTenant(other.admin, (tx) => core.enrolmentById(tx, enrolmentId))).rejects.toThrow(/Enrolment not found/);
  });

  it("facultyBatchIds, batchStudentIds, studentEnrolments and enrolmentById", async () => {
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    expect(core.facultyBatchIds(faculty)).toEqual([ctx.batch.id]);
    expect(core.facultyBatchIds(ctx.hod)).toEqual([]);
    expect(await core.withTenant(ctx.admin, (tx) => core.batchStudentIds(tx, ctx.batch.id))).toEqual([student.userId]);
    expect(await core.withTenant(student, (tx) => core.studentEnrolments(tx, student.userId))).toEqual([
      { enrolmentId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" },
    ]);
    const e = await core.withTenant(ctx.admin, (tx) => core.enrolmentById(tx, enrolmentId));
    expect(e).toMatchObject({ enrolmentId, userId: student.userId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" });
  });
});

describe("markEnrolmentCompleted", () => {
  it("only Admin, HOD or the system may complete an enrolment", async () => {
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    await expect(core.markEnrolmentCompleted(faculty, enrolmentId)).rejects.toThrow(/access/);
    await expect(core.markEnrolmentCompleted(student, enrolmentId)).rejects.toThrow(/access/);
    const otherDept = await makeDepartment(ctx.uni.id, "LAW", "Law");
    const otherHod = await (await person("Law HOD", "hod", { universityId: ctx.uni.id, departmentId: otherDept.id })).actor();
    await expect(core.markEnrolmentCompleted(otherHod, enrolmentId)).rejects.toThrow(/access/);
  });

  it("completes once and emits enrolment.completed once, even when called twice at the same time", async () => {
    const results = await Promise.all([
      core.markEnrolmentCompleted(ctx.hod, enrolmentId),
      core.markEnrolmentCompleted(systemActorFor(ctx.uni.id), enrolmentId),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["already_completed", "completed"]);
    expect(await core.markEnrolmentCompleted(ctx.admin, enrolmentId)).toEqual({ status: "already_completed", enrolmentId });
    const events = await eventsOfType("enrolment.completed", ctx.uni.id);
    expect(events.map((e) => e.payload)).toEqual([{ enrolmentId, userId: student.userId, courseId: ctx.course.id, batchId: ctx.batch.id }]);
    const [row] = await systemDb().select().from(enrolments).where(eq(enrolments.id, enrolmentId));
    expect(row.status).toBe("completed");
  });

  it("refuses enrolments that aren't active", async () => {
    const paid = await setupCourse({ name: "Held U", pricePaise: 1000 });
    const s = await paid.student("Holding Student");
    const r = await holdSeat(s, { batchId: paid.batch.id });
    await expect(core.markEnrolmentCompleted(paid.admin, (r as { enrolmentId: string }).enrolmentId)).rejects.toThrow(/active/);
  });
});

describe("money hooks for payments", () => {
  it("orderForCheckout shows the student their own order only", async () => {
    const paid = await setupCourse({ name: "Checkout U", pricePaise: 100_000 });
    const s = await paid.student("Checkout Student");
    const r = await holdSeat(s, { batchId: paid.batch.id });
    if (r.status !== "held") throw new Error("expected held");
    const o = await core.orderForCheckout(s, r.orderId);
    expect(o).toMatchObject({
      order: { id: r.orderId, status: "pending", basePaise: 100_000, gstPaise: 18_000, totalPaise: 118_000, gateway: "mock", userId: s.userId },
      course: { id: paid.course.id, title: "Data Analytics", gstRateBp: 1800 },
      batch: { id: paid.batch.id, name: "Weekday morning" },
      enrolment: { id: r.enrolmentId, status: "held" },
    });
    expect(o.order.gatewayOrderId).toMatch(/^mock_order_/);
    const other = await paid.student("Other Student");
    await expect(core.orderForCheckout(other, r.orderId)).rejects.toThrow(/Order not found/);
    await expect(core.orderForCheckout(paid.admin, r.orderId)).rejects.toThrow(/Order not found/);
    expect(await core.orderUniversity(o.order.gatewayOrderId!)).toBe(paid.uni.id);
    expect(await core.orderUniversity("order_unknown")).toBeNull();
    expect(await core.orderUniversity("")).toBeNull();
  });

  it("markOrderRefunded needs finance.refund, only refunds paid orders, and is idempotent", async () => {
    const paid = await setupCourse({ name: "Refund API U", pricePaise: 50_000 });
    const s = await paid.student("Refund Student");
    const r = await holdSeat(s, { batchId: paid.batch.id });
    if (r.status !== "held") throw new Error("expected held");
    await expect(core.markOrderRefunded(paid.admin, r.orderId, "rfnd_1")).rejects.toThrow(/Only paid orders/);
    await core.confirmPayment(paid.uni.id, { orderId: r.orderId, gatewayPaymentId: "pay_1" });
    await expect(core.markOrderRefunded(paid.hod, r.orderId, "rfnd_1")).rejects.toThrow(/access/);
    const accounts = await (await person("Accounts Arun", "accounts_fees", { universityId: paid.uni.id })).actor();
    expect(await core.markOrderRefunded(accounts, r.orderId, "rfnd_1")).toEqual({ status: "refunded", orderId: r.orderId });
    expect(await core.markOrderRefunded(accounts, r.orderId, "rfnd_1")).toEqual({ status: "already_refunded", orderId: r.orderId });
    const [o] = await systemDb().select().from(orders).where(eq(orders.id, r.orderId));
    expect(o.status).toBe("refunded");
    const other = await setupCourse({ name: "Refund Other U" });
    await expect(core.markOrderRefunded(other.admin, r.orderId, "x")).rejects.toThrow(/Order not found/);
  });

  it("the mock gateway refunds", async () => {
    expect(core.gateway().name).toBe("mock");
    await expect(core.gateway().refund({ gatewayPaymentId: "p", amountPaise: 100 })).resolves.toMatchObject({ status: "processed" });
  });
});

describe("Zinny team: universities and platform roles", () => {
  it("updateUniversity needs platform.manage_universities, validates, and logs", async () => {
    const am = await makeUser("Account Manager");
    await grant(am.id, "account_manager");
    const support = await makeUser("Support Only");
    await grant(support.id, "support_agent");
    const uni = await makeUniversity("Rename Me");
    await expect(core.updateUniversity(await loadActor(support.id, null), uni.id, { name: "Nope" })).rejects.toThrow(/access/);
    const actor = await loadActor(am.id, null);
    await expect(core.updateUniversity(actor, uni.id, { timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    await expect(core.updateUniversity(actor, uni.id, { invoicePrefix: "TOOLONG" })).rejects.toThrow(/1 to 4/);
    const after = await core.updateUniversity(actor, uni.id, { name: "Renamed University", gstin: "27aabcd1234e1z5", status: "suspended" });
    expect(after).toMatchObject({ name: "Renamed University", gstin: "27AABCD1234E1Z5", status: "suspended" });
    const trail = await core.supportTrail(await loadActor((await makeSuper()).id, null), uni.id);
    expect(trail[0]).toMatchObject({ action: "university.update", actorUserId: am.id });
    const [row] = await systemDb().select().from(universities).where(eq(universities.id, uni.id));
    expect(row.name).toBe("Renamed University");
  });

  it("grantPlatformRole and revokePlatformRole are Super Admin only and invite new people", async () => {
    const sa = await makeSuper();
    const am = await makeUser("Not Super");
    await grant(am.id, "account_manager");
    const saActor = await loadActor(sa.id, null);
    await expect(core.grantPlatformRole(await loadActor(am.id, null), { email: "x@zinny.test", name: "X", role: "content_qa" })).rejects.toThrow(/Super Admin/);
    await expect(core.grantPlatformRole(saActor, { email: "x@zinny.test", name: "X", role: "student" })).rejects.toThrow(/Zinny team role/);
    const email = `qa.${Date.now().toString(36)}@zinny.test`;
    const a = await core.grantPlatformRole(saActor, { email, name: "Quinn QA", role: "content_qa" });
    const again = await core.grantPlatformRole(saActor, { email, name: "Quinn QA", role: "content_qa" });
    expect(again.id).toBe(a.id);
    const qa = await loadActor(a.userId, null);
    expect(core.canPlatform(qa, "platform.content_review")).toBe(true);
    const invites = (await eventsOfType("user.invited")).filter((e) => e.payload.email === email);
    expect(invites).toHaveLength(1);
    expect(invites[0].universityId).toBeNull();
    expect(invites[0].payload).toMatchObject({ name: "Quinn QA", role: "content_qa" });
    await core.revokePlatformRole(saActor, a.id);
    expect(core.canPlatform(await loadActor(a.userId, null), "platform.content_review")).toBe(false);
    const [own] = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, sa.id));
    await expect(core.revokePlatformRole(saActor, own.id)).rejects.toThrow(/your own/);
  });
});

async function makeSuper() {
  const u = await makeUser("Super Sara");
  await grant(u.id, "super_admin");
  return u;
}
