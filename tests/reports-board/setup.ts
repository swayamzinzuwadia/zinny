/**
 * A university with two departments, paid and free courses, and every kind of order, with
 * dates pinned so date-range tests don't depend on today. Shared by the reports-board tests.
 *
 *   Computer Science (Hema): Data Analytics, ₹10,000 + 18% GST, batch "Weekday morning"
 *     s1 paid (invoice 15 Sep), s2 paid (invoice 2 Oct 00:15 IST), s3 paid then refunded (20 Oct),
 *     s4 seat held, awaiting payment (order placed 10 Oct), "=HYPERLINK" paid (21 Oct)
 *   Marketing (Mehul): Digital Marketing, free, batch "Evening"
 *     s1 enrolled 5 Oct, s5 enrolled 25 Oct
 */
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { enrolments, invoices, orders } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { markOrderRefunded } from "@/server/core";
import { createBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { confirmPayment, holdSeat } from "@/server/services/enrolment";
import { makeDepartment, person, setupCourse, slots } from "../fixtures";

export async function setupReports(name = "Reports University") {
  const base = await setupCourse({ name, pricePaise: 10_000_00, seatLimit: 20 });
  const { uni, dept: cs } = base;
  const mkt = await makeDepartment(uni.id, "MKT", "Marketing");
  const mehul = await (await person("Mehul Head", "hod", { universityId: uni.id, departmentId: mkt.id })).actor();
  const neel = await person("Neel Faculty", "permanent_faculty", { universityId: uni.id, departmentId: mkt.id });
  const dm = await createCourse(mehul, { departmentId: mkt.id, title: "Digital Marketing", pricePaise: 0 });
  const dmEvening = await createBatch(mehul, {
    courseId: dm.id,
    name: "Evening",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: 25,
    slots: slots([2, 4], "19:00", "21:00"),
    faculty: [{ userId: neel.user.id, role: "permanent_faculty" }],
  });
  await updateCourse(mehul, dm.id, { status: "published" });

  const board = await (await person("Bharat Board", "board_owner", { universityId: uni.id })).actor();
  const accounts = await (await person("Arun Accounts", "accounts_fees", { universityId: uni.id })).actor();
  const faculty = await loadActor(base.facultyUserId, uni.id);
  const studentOnly = await base.student("Plain Student");

  const s1 = await base.student("Riya Sharma");
  const s2 = await base.student("Kabir Mehta");
  const s3 = await base.student("Aditi Rao");
  const s4 = await base.student("Ishaan Gupta");
  const s5 = await base.student("Meera Nair");
  const evil = await base.student('=HYPERLINK("http://evil.example","Click")');

  const paid = async (s: typeof s1, when: string) => {
    const r = await holdSeat(s, { batchId: base.batch.id });
    if (r.status !== "held") throw new Error(`Expected a held seat, got ${r.status}`);
    await confirmPayment(uni.id, { orderId: r.orderId, gatewayPaymentId: `pay_${s.userId.slice(0, 8)}` });
    const at = new Date(when);
    await systemDb().update(orders).set({ paidAt: at, createdAt: at }).where(eq(orders.id, r.orderId));
    await systemDb().update(invoices).set({ issuedAt: at }).where(eq(invoices.orderId, r.orderId));
    await systemDb().update(enrolments).set({ enrolledAt: at }).where(eq(enrolments.id, r.enrolmentId));
    return r;
  };
  const free = async (s: typeof s1, when: string) => {
    const r = await holdSeat(s, { batchId: dmEvening.id });
    if (r.status !== "enrolled") throw new Error(`Expected a free enrolment, got ${r.status}`);
    await systemDb().update(enrolments).set({ enrolledAt: new Date(when) }).where(eq(enrolments.id, r.enrolmentId));
    return r;
  };

  const o1 = await paid(s1, "2026-09-15T06:00:00Z");
  const o2 = await paid(s2, "2026-10-01T18:45:00Z"); // 2 Oct, 00:15 in India
  const o3 = await paid(s3, "2026-10-20T05:00:00Z");
  await markOrderRefunded(base.admin, o3.orderId, "rfnd_test");
  const oEvil = await paid(evil, "2026-10-21T05:00:00Z");
  const pending = await holdSeat(s4, { batchId: base.batch.id });
  if (pending.status !== "held") throw new Error("Expected a held seat");
  await systemDb().update(orders).set({ createdAt: new Date("2026-10-10T05:00:00Z") }).where(eq(orders.id, pending.orderId));

  await free(s1, "2026-10-05T05:00:00Z");
  await free(s5, "2026-10-25T05:00:00Z");

  return {
    ...base,
    cs,
    mkt,
    mehul,
    neelUserId: neel.user.id,
    dm,
    dmEvening,
    board,
    accounts,
    faculty,
    studentOnly,
    students: { s1, s2, s3, s4, s5, evil },
    orderIds: { o1: o1.orderId, o2: o2.orderId, o3: o3.orderId, oEvil: oEvil.orderId, pending: pending.orderId },
  };
}

export type ReportsWorld = Awaited<ReturnType<typeof setupReports>>;
