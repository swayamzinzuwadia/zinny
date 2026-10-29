/** Content review, partners, Zinny billing, team and analytics. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, courses, universities } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import { analytics } from "@/modules/zinny-team-panel/services/analytics";
import { createInvoice, gstFor, listInvoices, markInvoicePaid, markInvoiceUnpaid, splitGst } from "@/modules/zinny-team-panel/services/billing";
import { coursePreview, flagCourse, listOpenFlags, markReviewed, resolveFlag, reviewQueue } from "@/modules/zinny-team-panel/services/content";
import { addContact, addNote, createPartner, getPartner, removeContact, updatePartner } from "@/modules/zinny-team-panel/services/partners";
import { addRole, inviteMember, listTeam, removeRole } from "@/modules/zinny-team-panel/services/team";
import { holdSeat } from "@/server/services/enrolment";
import { eventsOfType } from "../helpers/events";
import { makeUniversity, setupCourse } from "../fixtures";
import { team } from "./helpers";

afterAll(closeDb);

let sa: Actor, qa: Actor, am: Actor, fin: Actor, par: Actor;
beforeAll(async () => {
  [sa, qa, am, fin, par] = await Promise.all([
    team("Rec Super", "super_admin"),
    team("Rec QA", "content_qa"),
    team("Rec Manager", "account_manager"),
    team("Rec Finance", "finance_admin"),
    team("Rec Partners", "partnerships"),
  ]);
});

describe("content review", () => {
  it("queues published courses, flags them with notes, and never edits the course", async () => {
    const c = await setupCourse({ name: "Review U" });
    const inTab = async (tab: "to-review" | "flagged" | "cleared") => (await reviewQueue(qa, tab, { universityId: c.uni.id })).rows.map((r) => r.courseId);
    expect(await inTab("to-review")).toEqual([c.course.id]);
    const [before] = await systemDb().select().from(courses).where(eq(courses.id, c.course.id));

    await expect(flagCourse(qa, c.course.id, { category: "claims", note: "short" })).rejects.toThrow(/sentence/);
    await expect(flagCourse(qa, c.course.id, { category: "made-up", note: "A long enough note here." })).rejects.toThrow(/kind of issue/);
    const flag = await flagCourse(qa, c.course.id, { category: "claims", note: "Promises guaranteed placement without terms." });
    expect(await inTab("flagged")).toEqual([c.course.id]);
    expect(await inTab("to-review")).toEqual([]);
    // Account Managers can read the flag.
    expect((await listOpenFlags(am, { universityId: c.uni.id })).map((f) => f.note)).toEqual(["Promises guaranteed placement without terms."]);
    expect((await coursePreview(am, c.course.id)).batches[0].faculty).toEqual(["Faculty Farah"]);
    await expect(markReviewed(qa, c.course.id)).rejects.toThrow(/open flags/);

    await resolveFlag(qa, flag.id, "University removed the guarantee.");
    await expect(resolveFlag(qa, flag.id, "Again")).rejects.toThrow(/already resolved/);
    expect(await inTab("cleared")).toEqual([c.course.id]);
    await markReviewed(qa, c.course.id, "Looks good now.");

    const [after] = await systemDb().select().from(courses).where(eq(courses.id, c.course.id));
    expect(after).toEqual(before);
    const actions = (await systemDb().select().from(auditLog).where(eq(auditLog.actorUserId, qa.userId))).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["plat.flag.create", "plat.flag.resolve", "plat.review.clear"]));
  });
});

describe("partners", () => {
  it("keeps contacts with one main contact, notes and status changes", async () => {
    await expect(createPartner(par, { name: "X", kind: "sponsor", status: "active" })).rejects.toThrow(/name/);
    await expect(createPartner(par, { name: "Bad Site", kind: "sponsor", status: "active", website: "not a site" })).rejects.toThrow(/website/);
    const p = await createPartner(par, { name: "BrightPath Test", kind: "sponsor", status: "prospect", website: "brightpath.in" });
    expect(p).toMatchObject({ website: "https://brightpath.in", ownerUserId: par.userId });
    await expect(addContact(par, p.id, { name: "No Way" })).rejects.toThrow(/email or a phone/);
    const a = await addContact(par, p.id, { name: "Ananya", email: "ananya@bp.in" });
    const b = await addContact(par, p.id, { name: "Vivek", phone: "+91 98200 12345", isPrimary: true });
    let full = await getPartner(par, p.id);
    expect(full.contacts.map((c) => [c.name, c.isPrimary])).toEqual([["Vivek", true], ["Ananya", false]]);
    await removeContact(par, b.id);
    full = await getPartner(par, p.id);
    expect(full.contacts.map((c) => [c.id, c.isPrimary])).toEqual([[a.id, true]]);
    await addNote(par, p.id, "First call went well.");
    await updatePartner(par, p.id, { name: "BrightPath Test", kind: "sponsor", status: "active", ownerUserId: sa.userId });
    full = await getPartner(par, p.id);
    expect(full.partner).toMatchObject({ status: "active", ownerUserId: sa.userId });
    expect(full.notes.map((n) => n.body)).toEqual(["First call went well."]);
    await expect(updatePartner(par, p.id, { name: "BrightPath Test", kind: "sponsor", status: "active", ownerUserId: qa.userId.replace(/.$/, "0") })).rejects.toThrow(/Zinny team/);
  });
});

describe("Zinny billing", () => {
  it("splits GST by state, numbers invoices per financial year, and tracks paid and unpaid", async () => {
    expect(gstFor(45_000_00, 1800)).toBe(8_100_00);
    expect(splitGst(8_101, true)).toEqual({ cgstPaise: 4050, sgstPaise: 4051, igstPaise: 0 });
    const mh = await makeUniversity("Bill Maharashtra"); // state 27, same as Zinny
    const ka = await makeUniversity("Bill Karnataka");
    await systemDb().update(universities).set({ stateCode: "29" }).where(eq(universities.id, ka.id));
    const input = { periodStart: "2026-04-01", periodEnd: "2027-03-31", description: "Zinny Standard licence", basePaise: 1_00_000_00, gstRateBp: 1800, issueDate: "2026-10-01", dueDate: "2026-10-16" };

    await expect(createInvoice(fin, { ...input, universityId: mh.id, dueDate: "2026-09-01" })).rejects.toThrow(/due date/);
    await expect(createInvoice(fin, { ...input, universityId: mh.id, gstRateBp: 1700 })).rejects.toThrow(/GST rate/);
    const one = await createInvoice(fin, { ...input, universityId: mh.id });
    const two = await createInvoice(fin, { ...input, universityId: ka.id });
    expect(one).toMatchObject({ cgstPaise: 9_000_00, sgstPaise: 9_000_00, igstPaise: 0, totalPaise: 1_18_000_00, buyerName: "Bill Maharashtra Trust", status: "unpaid" });
    expect(two).toMatchObject({ igstPaise: 18_000_00, cgstPaise: 0, totalPaise: 1_18_000_00 });
    expect(one.number).toMatch(/^ZNY\/26-27\/\d{4}$/);
    expect(Number(two.number.slice(-4))).toBe(Number(one.number.slice(-4)) + 1);

    const overdue = (await listInvoices(fin, { status: "overdue", universityId: mh.id }, "2026-10-29")).invoices;
    expect(overdue.map((i) => i.id)).toEqual([one.id]);
    await expect(markInvoicePaid(fin, one.id, { paidOn: "2026-09-01", reference: "UTR 123" })).rejects.toThrow(/before the invoice/);
    await markInvoicePaid(fin, one.id, { paidOn: "2026-10-20", reference: "UTR 123456" }, "2026-10-29");
    await expect(markInvoicePaid(fin, one.id, { paidOn: "2026-10-20", reference: "UTR 123456" }, "2026-10-29")).rejects.toThrow(/already marked paid/);
    const { summary } = await listInvoices(fin, { universityId: mh.id }, "2026-10-29");
    expect(summary).toMatchObject({ outstanding: 0, collectedFy: 1_18_000_00 });
    await markInvoiceUnpaid(fin, one.id, "Cheque bounced");
    const log = (await systemDb().select().from(auditLog).where(eq(auditLog.universityId, mh.id))).map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(["plat.invoice.create", "plat.invoice.paid", "plat.invoice.unpaid"]));
  });
});

describe("team", () => {
  it("Super Admins invite people and give or remove roles through core", async () => {
    const email = `new.${Date.now().toString(36)}@zinny.test`;
    const a = await inviteMember(sa, { name: "Nina New", email, role: "support_agent" });
    await expect(inviteMember(sa, { name: "Nina New", email, role: "support_agent" })).rejects.toThrow(/already a Support Agent/);
    await addRole(sa, a.userId, "content_qa");
    const member = (await listTeam(sa)).find((m) => m.email === email)!;
    expect(member.roles.map((r) => r.role)).toEqual(["support_agent", "content_qa"]);
    expect(member.invited).toBe(true);
    expect((await eventsOfType("user.invited")).filter((e) => e.payload.email === email)).toHaveLength(2);
    await removeRole(sa, member.roles[0].assignmentId);
    expect((await listTeam(sa)).find((m) => m.email === email)!.roles.map((r) => r.role)).toEqual(["content_qa"]);
  });
});

describe("analytics", () => {
  it("counts universities, active students, weekly enrolments and money collected", async () => {
    const free = await setupCourse({ name: "Stats Free U" });
    const paid = await setupCourse({ name: "Stats Paid U", pricePaise: 5_000_00 });
    await holdSeat(await free.student("Stat One"), { batchId: free.batch.id });
    await holdSeat(await free.student("Stat Two"), { batchId: free.batch.id });
    const { confirmPayment } = await import("@/server/core");
    const r = await holdSeat(await paid.student("Stat Payer"), { batchId: paid.batch.id });
    if (r.status !== "held") throw new Error("expected a held seat");
    await confirmPayment(paid.uni.id, { orderId: r.orderId, gatewayPaymentId: "pay_stats" });

    const one = await analytics(am, { universityId: free.uni.id });
    expect(one).toMatchObject({ universities: { total: 1, active: 1 }, activeStudents: 2, students: 2 });
    expect(one.weeks.at(-1)!.enrolments).toBe(2);
    expect(one.months.at(-1)!.paise).toBe(0);
    const two = await analytics(am, { universityId: paid.uni.id });
    expect(two.months.at(-1)).toMatchObject({ paise: 5_900_00, payments: 1 });
    const all = await analytics(am);
    const row = all.perUniversity.find((u) => u.id === paid.uni.id)!;
    expect(row).toMatchObject({ activeStudents: 1, enrolments12w: 1, collectedMonth: 5_900_00 });
    expect(all.weeks).toHaveLength(12);
    expect(all.months).toHaveLength(12);
  });
});
