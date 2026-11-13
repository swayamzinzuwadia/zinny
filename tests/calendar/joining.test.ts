/**
 * Joining a batch, by every path, puts it on both calendars at once: the student's timetable
 * (studentTimetable, which the learner home and timetable pages read) and the batch's roster
 * and seat count. Also: clash warnings before joining (catalogue, approval, staff adding a
 * student, switching, the marketplace across institutes) and clashing classes marked after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { batches, orders, universities } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { menuFor } from "@/server/authz/menu";
import { addSessionOverride, batchRoster, createBatch, getBatchDetail, updateBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import {
  addStudentToBatch,
  batchOptions,
  confirmPayment,
  decideEnrolment,
  decideSwitch,
  holdSeat,
  listEnrolmentRequests,
  requestSwitch,
  studentsToAdd,
} from "@/server/services/enrolment";
import { facultyTimetable, studentTimetable } from "@/server/services/timetable";
import { signUpMarketplaceLearner } from "@/modules/identity/auth";
import { createBatchListing } from "@/modules/marketplace/listings";
import { liveClashes, startPurchase } from "@/modules/marketplace/service";
import { WEEKDAYS, person, setupCourse, slots, uniqueCode } from "../fixtures";

afterAll(() => closeDb());

// setupCourse's batch: Mon–Fri 9–11 am from Mon 4 Nov 2030 to 31 Jan 2031.
const WEEK = { from: "2030-11-04", to: "2030-11-10" };

type Shop = Awaited<ReturnType<typeof setupCourse>>;
let s: Shop;
let ml: { courseId: string; batchId: string };
let python: { courseId: string; morning: string; evening: string };

async function addCourse(shop: Shop, title: string, batchList: { name: string; days: number[]; start: string; end: string; approval?: boolean }[]) {
  const course = await createCourse(shop.hod, { departmentId: shop.dept.id, title, pricePaise: 0 });
  const ids: string[] = [];
  for (const b of batchList) {
    const created = await createBatch(shop.hod, {
      courseId: course.id,
      name: b.name,
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(b.days, b.start, b.end),
      faculty: [{ userId: shop.facultyUserId, role: "permanent_faculty" }],
    });
    if (b.approval) await updateBatch(shop.hod, created.id, { approvalRequired: true });
    ids.push(created.id);
  }
  await updateCourse(shop.hod, course.id, { status: "published" });
  return { courseId: course.id, ids };
}

const sessionsOf = async (a: Actor, batchId: string) => (await studentTimetable(a, WEEK)).sessions.filter((x) => x.batchId === batchId);
const rosterIds = async (batchId: string) => (await batchRoster(s.admin, batchId)).filter((r) => r.status === "active").map((r) => r.userId);
const seats = async (batchId: string) => (await getBatchDetail(s.admin, batchId)).seatsTaken;

beforeAll(async () => {
  s = await setupCourse({ name: `Calendar ${uniqueCode()}` });
  // Machine Learning meets Mon–Fri 10 am–12 pm: it overlaps Data Analytics' 9–11 am.
  const m = await addCourse(s, "Machine Learning", [{ name: "Morning", days: WEEKDAYS, start: "10:00", end: "12:00" }]);
  ml = { courseId: m.courseId, batchId: m.ids[0] };
  const p = await addCourse(s, "Python Basics", [
    { name: "Python morning", days: WEEKDAYS, start: "10:30", end: "11:30" },
    { name: "Python evening", days: WEEKDAYS, start: "17:00", end: "19:00", approval: true },
  ]);
  python = { courseId: p.courseId, morning: p.ids[0], evening: p.ids[1] };
});

describe("every way of joining shows on both calendars at once", () => {
  it("self-enrolling from the catalogue", async () => {
    const riya = await s.student("Riya Catalogue");
    const before = await seats(s.batch.id);
    expect(await holdSeat(riya, { batchId: s.batch.id })).toMatchObject({ status: "enrolled" });
    expect(await sessionsOf(riya, s.batch.id)).toHaveLength(5);
    expect(await rosterIds(s.batch.id)).toContain(riya.userId);
    expect(await seats(s.batch.id)).toBe(before + 1);
  });

  it("asking to join, then being accepted", async () => {
    const kabir = await s.student("Kabir Request");
    const r = await holdSeat(kabir, { batchId: python.evening });
    expect(r.status).toBe("requested");
    // Waiting: not on the timetable or the roster yet.
    expect(await sessionsOf(kabir, python.evening)).toHaveLength(0);
    expect(await rosterIds(python.evening)).not.toContain(kabir.userId);
    await decideEnrolment(s.hod, (r as { enrolmentId: string }).enrolmentId, true);
    expect(await sessionsOf(kabir, python.evening)).toHaveLength(5);
    expect(await rosterIds(python.evening)).toContain(kabir.userId);
  });

  it("staff adding a student", async () => {
    const aditi = await s.student("Aditi Added");
    const me = await loadActor(aditi.userId, s.uni.id);
    const email = (await studentsToAdd(s.admin, s.batch.id)).find((x) => x.id === aditi.userId)!.email;
    const before = await seats(s.batch.id);
    const r = await addStudentToBatch(s.admin, { batchId: s.batch.id, email: email.toUpperCase() });
    expect(r).toMatchObject({ status: "enrolled", clashes: [] });
    expect(await sessionsOf(me, s.batch.id)).toHaveLength(5);
    expect(await rosterIds(s.batch.id)).toContain(aditi.userId);
    expect(await seats(s.batch.id)).toBe(before + 1);
    // Once in, they aren't offered again, and adding twice says so.
    expect((await studentsToAdd(s.admin, s.batch.id)).map((x) => x.id)).not.toContain(aditi.userId);
    await expect(addStudentToBatch(s.admin, { batchId: s.batch.id, email })).rejects.toThrow(/already in Weekday morning/);
  });

  it("buying a seat in a live batch on the marketplace", async () => {
    const listing = await createBatchListing(s.hod, { batchId: s.batch.id, description: "Live.", pricePaise: 300_000 });
    const buyer = await marketplaceLearner();
    const { orderId } = await startPurchase(buyer, listing.id);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
    expect((await confirmPayment(order.universityId, { orderId, gatewayPaymentId: `pay_${orderId.slice(0, 8)}` })).status).toBe("enrolled");
    expect(await sessionsOf(await loadActor(buyer, s.uni.id), s.batch.id)).toHaveLength(5);
    expect(await rosterIds(s.batch.id)).toContain(buyer);
  });

  it("switching batch: the new batch appears and the old one disappears", async () => {
    const zoya = await s.student("Zoya Switch");
    const r = await holdSeat(zoya, { batchId: python.morning });
    const enrolmentId = (r as { enrolmentId: string }).enrolmentId;
    expect(await sessionsOf(zoya, python.morning)).toHaveLength(5);
    const req = await requestSwitch(zoya, { enrolmentId, toBatchId: python.evening });
    expect(req.status).toBe("requested");
    await decideSwitch(s.hod, (req as { requestId: string }).requestId, { approve: true });
    expect(await sessionsOf(zoya, python.morning)).toHaveLength(0);
    expect(await sessionsOf(zoya, python.evening)).toHaveLength(5);
    expect(await rosterIds(python.morning)).not.toContain(zoya.userId);
    expect(await rosterIds(python.evening)).toContain(zoya.userId);
  });
});

describe("clash warnings before joining", () => {
  it("the catalogue picker and joining warn, then join anyway when the student says so", async () => {
    const neha = await s.student("Neha Clash");
    await holdSeat(neha, { batchId: s.batch.id });
    const opts = await batchOptions(neha, ml.courseId);
    expect(opts.options[0].clashes[0]).toMatchObject({ batchName: "Weekday morning", courseTitle: "Data Analytics", when: "Mon 9 am–11 am" });
    const first = await holdSeat(neha, { batchId: ml.batchId });
    expect(first.status).toBe("clash");
    expect(await sessionsOf(neha, ml.batchId)).toHaveLength(0);
    expect(await holdSeat(neha, { batchId: ml.batchId, acknowledgeClash: true })).toMatchObject({ status: "enrolled" });

    // After joining anyway, both classes are marked on every clashing day.
    const week = (await studentTimetable(neha, WEEK)).sessions;
    const marked = week.filter((x) => x.clashesWith);
    expect(marked).toHaveLength(10);
    expect(marked.find((x) => x.batchId === ml.batchId)!.clashesWith![0]).toMatchObject({ courseTitle: "Data Analytics" });
  });

  it("an extra class added to an existing batch counts as a clash", async () => {
    const om = await s.student("Om Extra");
    await holdSeat(om, { batchId: s.batch.id });
    // A Saturday-only course, and Data Analytics adds an extra Saturday class at the same time.
    const sat = await addCourse(s, `Saturday Studio ${uniqueCode()}`, [{ name: "Saturday", days: [6], start: "09:00", end: "12:00" }]);
    expect(await holdSeat(await s.student("Free Saturday"), { batchId: sat.ids[0] })).toMatchObject({ status: "enrolled" });
    await addSessionOverride(s.hod, s.batch.id, { date: "2030-11-09", kind: "extra", startTime: "10:00", endTime: "11:00", note: "Catch-up" });
    const r = await holdSeat(om, { batchId: sat.ids[0] });
    expect(r).toMatchObject({ status: "clash", clashes: [expect.objectContaining({ date: "2030-11-09", when: "Sat, 9 Nov, 10 am–11 am" })] });
  });

  it("staff adding a student who clashes get a warning naming the other batch, and can add anyway", async () => {
    const dev = await s.student("Dev Admin Clash");
    await holdSeat(dev, { batchId: s.batch.id });
    const email = (await studentsToAdd(s.admin, ml.batchId)).find((x) => x.id === dev.userId)!.email;
    const warn = await addStudentToBatch(s.admin, { batchId: ml.batchId, email });
    expect(warn).toMatchObject({ status: "clash", student: { id: dev.userId }, clashes: expect.arrayContaining([expect.objectContaining({ courseTitle: "Data Analytics", batchName: "Weekday morning" })]) });
    expect(await rosterIds(ml.batchId)).not.toContain(dev.userId);
    const added = await addStudentToBatch(s.admin, { batchId: ml.batchId, email, acknowledgeClash: true });
    expect(added.status).toBe("enrolled");
    expect((await studentTimetable(await loadActor(dev.userId, s.uni.id), WEEK)).sessions.some((x) => x.batchId === ml.batchId && x.clashesWith)).toBe(true);
  });

  it("a request that clashes says so to whoever accepts it", async () => {
    const isha = await s.student("Isha Request Clash");
    // Python evening is 5–7 pm; a 6 pm class elsewhere clashes with it.
    const evening = await addCourse(s, `Evening Lab ${uniqueCode()}`, [{ name: "Lab", days: [1], start: "18:00", end: "19:30" }]);
    await holdSeat(isha, { batchId: evening.ids[0] });
    await holdSeat(isha, { batchId: python.evening, acknowledgeClash: true });
    const req = (await listEnrolmentRequests(s.hod, { batchId: python.evening })).find((x) => x.student.id === isha.userId)!;
    expect(req.clashWarning).toMatch(/^Python evening clashes with Evening Lab .* – Lab on Mon, 6 pm–7:30 pm\.$/);
  });

  it("a switch request to a clashing batch warns first", async () => {
    const jai = await s.student("Jai Switch Clash");
    const e = await holdSeat(jai, { batchId: python.evening, acknowledgeClash: true });
    await holdSeat(jai, { batchId: s.batch.id });
    const enrolmentId = (e as { enrolmentId: string }).enrolmentId;
    // Requested, not active yet: accept it so there is something to switch.
    if (e.status === "requested") await decideEnrolment(s.hod, enrolmentId, true);
    const r = await requestSwitch(jai, { enrolmentId, toBatchId: python.morning });
    expect(r).toMatchObject({ status: "clash", clashes: expect.arrayContaining([expect.objectContaining({ courseTitle: "Data Analytics" })]) });
    expect((await requestSwitch(jai, { enrolmentId, toBatchId: python.morning, acknowledgeClash: true })).status).toBe("requested");
  });
});

describe("who may add students", () => {
  it("staff who edit the batch may; faculty, students and another institute's admin may not", async () => {
    const target = await s.student("Tara Target");
    const email = (await studentsToAdd(s.admin, ml.batchId)).find((x) => x.id === target.userId)!.email;
    const faculty = await loadActor(s.facultyUserId, s.uni.id);
    const other = await setupCourse({ name: `Elsewhere ${uniqueCode()}` });
    for (const who of [faculty, target, other.admin]) {
      await expect(addStudentToBatch(who, { batchId: ml.batchId, email })).rejects.toMatchObject({ status: expect.any(Number) });
      await expect(studentsToAdd(who, ml.batchId)).rejects.toMatchObject({ status: expect.any(Number) });
    }
    expect(await rosterIds(ml.batchId)).not.toContain(target.userId);
    // The HOD of the batch's department may.
    expect((await addStudentToBatch(s.hod, { batchId: ml.batchId, email })).status).toBe("enrolled");
  });

  it("only the institute's students can be added, and a full batch says how to make room", async () => {
    const stranger = await person("Not A Student", "permanent_faculty", { universityId: s.uni.id, departmentId: s.dept.id });
    await expect(addStudentToBatch(s.admin, { batchId: ml.batchId, email: stranger.user.email })).rejects.toThrow(/No student with the email/);
    const tiny = await addCourse(s, `Tiny ${uniqueCode()}`, [{ name: "One seat", days: [7], start: "08:00", end: "09:00" }]);
    await systemDb().update(batches).set({ seatLimit: 1 }).where(eq(batches.id, tiny.ids[0]));
    const a = await s.student("Seat One");
    const b = await s.student("Seat Two");
    const emails = new Map((await studentsToAdd(s.admin, tiny.ids[0])).map((x) => [x.id, x.email]));
    expect((await addStudentToBatch(s.admin, { batchId: tiny.ids[0], email: emails.get(a.userId)! })).status).toBe("enrolled");
    await expect(addStudentToBatch(s.admin, { batchId: tiny.ids[0], email: emails.get(b.userId)! })).rejects.toThrow(/is full\. Add seats/);
  });

  it("a student who asked for a seat gets the place staff give them instead", async () => {
    const ravi = await s.student("Ravi Asked");
    const asked = await holdSeat(ravi, { batchId: python.evening });
    expect(asked.status).toBe("requested");
    const email = (await studentsToAdd(s.admin, python.morning)).find((x) => x.id === ravi.userId)!.email;
    expect((await addStudentToBatch(s.admin, { batchId: python.morning, email, acknowledgeClash: true })).status).toBe("enrolled");
    expect(await listEnrolmentRequests(s.hod, { batchId: python.evening })).not.toContainEqual(expect.objectContaining({ enrolmentId: (asked as { enrolmentId: string }).enrolmentId }));
    expect(await sessionsOf(ravi, python.morning)).toHaveLength(5);
  });
});

async function marketplaceLearner() {
  const r = await signUpMarketplaceLearner({
    name: "Calendar Buyer",
    email: `cal.${uniqueCode("").toLowerCase()}@market.test`,
    password: "a quiet green field",
    confirm: "a quiet green field",
    ip: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  if (r.status !== "created") throw new Error("Sign-up was limited.");
  return r.userId;
}

describe("marketplace clashes across institutes", () => {
  it("names the batch the buyer already has at another institute, and skips other time zones", async () => {
    const a = await setupCourse({ name: `Shop A ${uniqueCode()}` });
    const b = await setupCourse({ name: `Shop B ${uniqueCode()}` });
    const listingA = await createBatchListing(a.hod, { batchId: a.batch.id, description: "", pricePaise: 100_000 });
    const listingB = await createBatchListing(b.hod, { batchId: b.batch.id, description: "", pricePaise: 100_000 });
    const buyer = await marketplaceLearner();
    expect((await liveClashes(buyer, [b.batch.id])).size).toBe(0);
    expect((await liveClashes(null, [b.batch.id])).size).toBe(0);

    const { orderId } = await startPurchase(buyer, listingA.id);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
    await confirmPayment(order.universityId, { orderId, gatewayPaymentId: `pay_${orderId.slice(0, 8)}` });

    const clashes = (await liveClashes(buyer, [b.batch.id])).get(b.batch.id)!;
    expect(clashes[0]).toMatchObject({ batchId: a.batch.id, courseTitle: "Data Analytics", batchName: `Weekday morning, ${a.uni.name}`, when: "Mon 9 am–11 am" });
    // Their own batch never clashes with itself.
    expect((await liveClashes(buyer, [a.batch.id])).size).toBe(0);
    expect(listingB.id).toBeTruthy();

    await systemDb().update(universities).set({ timezone: "Europe/London" }).where(eq(universities.id, b.uni.id));
    expect((await liveClashes(buyer, [b.batch.id])).size).toBe(0);
  });

  it("in a cart, two seats that meet together warn about each other", async () => {
    const a = await setupCourse({ name: `Cart A ${uniqueCode()}` });
    const b = await setupCourse({ name: `Cart B ${uniqueCode()}` });
    const buyer = await marketplaceLearner();
    const cart = await liveClashes(buyer, [a.batch.id, b.batch.id], { together: true });
    expect(cart.get(a.batch.id)![0].batchId).toBe(b.batch.id);
    expect(cart.get(b.batch.id)![0].batchId).toBe(a.batch.id);
    expect((await liveClashes(buyer, [a.batch.id, b.batch.id])).size).toBe(0);
  });
});

describe("the faculty timetable", () => {
  it("shows the batches a faculty member teaches, and nothing to someone who teaches none", async () => {
    const faculty = await loadActor(s.facultyUserId, s.uni.id);
    const t = await facultyTimetable(faculty, WEEK);
    for (const id of [s.batch.id, ml.batchId, python.morning, python.evening]) expect(t.sessions.some((x) => x.batchId === id)).toBe(true);
    const student = await s.student("No Teaching");
    expect((await facultyTimetable(student, WEEK)).sessions).toEqual([]);
    expect((await facultyTimetable(s.admin, WEEK)).sessions).toEqual([]);
  });

  it("is in the menu only for people who teach batches", async () => {
    const hrefs = (a: Actor) => menuFor(a, s.uni.id).find((x) => x.key === "products")?.items.map((i) => i.href) ?? [];
    expect(hrefs(await loadActor(s.facultyUserId, s.uni.id))).toContain("/products/timetable");
    expect(hrefs(s.admin)).not.toContain("/products/timetable");
  });
});
