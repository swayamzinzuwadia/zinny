/** "Add a student" on the dashboard: account, batch and fee receipt in one transaction. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments, roleAssignments, studentDepartments, users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { addStudentQuickly, addStudentsToBatch, type QuickStudentResult } from "@/server/services/daily";
import { createBatch } from "@/server/services/batches";
import { createCourse } from "@/server/services/courses";
import { payManualInvoices } from "@/modules/payments/schema";
import { eventsOfType } from "../helpers/events";
import { WEEKDAYS, person, setupCourse, slots } from "../fixtures";

afterAll(closeDb);

const email = (tag: string) => `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
/** The added result, failing the test on a clash warning. */
function added(r: QuickStudentResult) {
  if (r.status !== "added") throw new Error(`Expected the student to be added, got a clash: ${r.warning}`);
  return r;
}
const userByEmail = async (e: string) => (await systemDb().select().from(users).where(eq(users.email, e)))[0];

describe("adding a student from the dashboard", () => {
  it("creates the student, gives them a seat and records the fee at the course price", async () => {
    const ctx = await setupCourse({ name: "Quick Student U", pricePaise: 350_000 });
    const e = email("riya");
    const r = added(await addStudentQuickly(ctx.admin, { name: "Riya Rao", email: e, phone: "98000 00001", batchId: ctx.batch.id, fee: { mode: "cash" } }));
    expect(r.placement?.added).toHaveLength(1);
    expect(r.invoiceNumber).toMatch(/\/\d{5}$/);
    expect(r.invited).toBe(true);
    const u = await userByEmail(e);
    expect(u.name).toBe("Riya Rao");
    const roles = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, u.id));
    expect(roles.map((x) => x.role)).toEqual(["student"]);
    const [seat] = await systemDb().select().from(enrolments).where(eq(enrolments.userId, u.id));
    expect(seat).toMatchObject({ batchId: ctx.batch.id, status: "active" });
    const [inv] = await systemDb().select().from(payManualInvoices).where(eq(payManualInvoices.userId, u.id));
    expect(inv).toMatchObject({ status: "paid", paymentMode: "cash", subtotalPaise: 350_000 });
    const invited = await eventsOfType("user.invited", ctx.uni.id);
    expect(invited.some((ev) => ev.payload.userId === u.id)).toBe(true);
  });

  it("without a batch, the student joins the department picked", async () => {
    const ctx = await setupCourse({ name: "Quick Dept U" });
    const e = email("dev");
    const r = added(await addStudentQuickly(ctx.hod, { name: "Dev Das", email: e, departmentId: ctx.dept.id }));
    expect(r.placement).toBeNull();
    const depts = await systemDb().select().from(studentDepartments).where(eq(studentDepartments.userId, r.userId));
    expect(depts.map((d) => d.departmentId)).toEqual([ctx.dept.id]);
  });

  it("allows a HOD in their department, and refuses faculty", async () => {
    const ctx = await setupCourse({ name: "Quick Perms U" });
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    await expect(addStudentQuickly(faculty, { name: "No Way", email: email("no"), batchId: ctx.batch.id })).rejects.toBeInstanceOf(ForbiddenError);
    const r = added(await addStudentQuickly(ctx.hod, { name: "Hod Pick", email: email("hod"), batchId: ctx.batch.id }));
    expect(r.placement?.added).toHaveLength(1);
  });

  it("only finance staff record a fee; a HOD who ticks it is told, and nothing is saved", async () => {
    const ctx = await setupCourse({ name: "Quick Fee Perm U", pricePaise: 100_000 });
    const e = email("fee");
    await expect(addStudentQuickly(ctx.hod, { name: "Fee Tick", email: e, batchId: ctx.batch.id, fee: { mode: "cash" } })).rejects.toBeInstanceOf(ValidationError);
    expect(await userByEmail(e)).toBeUndefined();
  });

  it("rolls everything back when the fee can't be recorded", async () => {
    const ctx = await setupCourse({ name: "Quick Rollback U", pricePaise: 100_000 });
    const e = email("roll");
    // A UPI payment needs its transaction id.
    const err = await addStudentQuickly(ctx.admin, { name: "Roll Back", email: e, batchId: ctx.batch.id, fee: { mode: "upi" } }).catch((x) => x);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/UPI transaction id/);
    const u = await userByEmail(e);
    if (u) {
      expect(await systemDb().select().from(enrolments).where(eq(enrolments.userId, u.id))).toHaveLength(0);
      expect(await systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.userId, u.id), eq(roleAssignments.universityId, ctx.uni.id)))).toHaveLength(0);
    }
  });

  it("checks the name, email and where they go", async () => {
    const ctx = await setupCourse({ name: "Quick Checks U" });
    await expect(addStudentQuickly(ctx.admin, { name: "A", email: email("a"), batchId: ctx.batch.id })).rejects.toThrow(/full name/);
    await expect(addStudentQuickly(ctx.admin, { name: "Abe Lin", email: "not-an-email", batchId: ctx.batch.id })).rejects.toThrow(/valid email/);
    await expect(addStudentQuickly(ctx.admin, { name: "Abe Lin", email: email("b") })).rejects.toThrow(/Pick a batch/);
  });

  it("a HOD of another department can't add students to this batch", async () => {
    const ctx = await setupCourse({ name: "Quick Other U" });
    const { makeDepartment } = await import("../fixtures");
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Mkt Hod", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    const e = email("other");
    await expect(addStudentQuickly(otherHod, { name: "Cross Dept", email: e, batchId: ctx.batch.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await userByEmail(e)).toBeUndefined();
  });

  it("an existing student whose other batch clashes gets a warning first, with nothing saved, then is added anyway", async () => {
    const ctx = await setupCourse({ name: "Quick Clash U", pricePaise: 100_000 });
    const ml = await createCourse(ctx.hod, { departmentId: ctx.dept.id, title: "Machine Learning", pricePaise: 0 });
    const mlBatch = await createBatch(ctx.hod, {
      courseId: ml.id,
      name: "ML morning",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "10:00", "12:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
    });
    const e = email("clash");
    added(await addStudentQuickly(ctx.admin, { name: "Clash Kid", email: e, batchId: ctx.batch.id }));
    const warn = await addStudentQuickly(ctx.admin, { name: "Clash Kid", email: e, batchId: mlBatch.id, fee: { mode: "cash", amountPaise: 50_000 } });
    expect(warn).toMatchObject({ status: "clash", warning: expect.stringMatching(/^Clash Kid's place in Machine Learning, ML morning clashes with Data Analytics – Weekday morning/) });
    const u = await userByEmail(e);
    expect(await systemDb().select().from(enrolments).where(eq(enrolments.batchId, mlBatch.id))).toHaveLength(0);
    expect(await systemDb().select().from(payManualInvoices).where(eq(payManualInvoices.userId, u.id))).toHaveLength(0);
    const r = added(await addStudentQuickly(ctx.admin, { name: "Clash Kid", email: e, batchId: mlBatch.id, fee: { mode: "cash", amountPaise: 50_000 }, acknowledgeClash: true }));
    expect(r.placement?.clashes).toHaveLength(1);
    // Already a student here: no second invitation.
    expect(r.invited).toBe(false);
    expect(r.invoiceNumber).toBeTruthy();
    // The same rule as the Students list: already in the batch means nothing more to do.
    expect((await addStudentsToBatch(ctx.admin, mlBatch.id, [u.id])).already).toHaveLength(1);
  });
});
