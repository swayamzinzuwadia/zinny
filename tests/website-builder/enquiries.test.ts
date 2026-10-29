import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { notifications } from "@/db/schema";
import {
  addEnquiryNote,
  assignEnquiry,
  getEnquiry,
  listEnquiries,
  setEnquiryStatus,
  submitEnquiry,
} from "@/modules/website-builder/enquiries";
import { fingerprint, RATE_LIMITS } from "@/modules/website-builder/rate-limit";
import { submitReview } from "@/modules/website-builder/reviews";
import { siteEnquiries, siteReviews, siteSubmissions } from "@/modules/website-builder/schema";
import { eventsOfType } from "../helpers/events";
import { person } from "../fixtures";
import { freshIp, siteFixture } from "./helpers";

afterAll(closeDb);

const valid = { name: "Karan Malhotra", email: "Karan.M@Example.com", phone: "+91 98765 43210", message: "Is there an instalment option?" };

describe("website-builder: the enquiry form", () => {
  it("saves the enquiry, emits enquiry.received once and notifies everyone who manages the website", async () => {
    const { uni, admin, hod, course } = await siteFixture("Enquiry U");
    const second = await (await person("Second Admin", "institute_admin", { universityId: uni.id })).actor();
    const res = await submitEnquiry(uni.id, { ...valid, courseId: course.id, source: "course" }, { ip: freshIp(), slug: uni.slug });
    expect(res.status).toBe("saved");
    if (res.status !== "saved") return;

    const [row] = await systemDb().select().from(siteEnquiries).where(eq(siteEnquiries.id, res.id));
    expect(row).toMatchObject({ universityId: uni.id, name: "Karan Malhotra", email: "karan.m@example.com", phone: "+91 98765 43210", courseId: course.id, status: "new", source: "course" });

    const events = (await eventsOfType("enquiry.received", uni.id)).filter((e) => (e.payload as { enquiryId: string }).enquiryId === res.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ enquiryId: res.id, name: "Karan Malhotra", email: "karan.m@example.com", phone: "+91 98765 43210" });

    const notified = await systemDb().select().from(notifications).where(and(eq(notifications.universityId, uni.id), eq(notifications.kind, "website.enquiry")));
    expect(notified.map((n) => n.userId).sort()).toEqual([admin.userId, second.userId].sort());
    expect(notified.some((n) => n.userId === hod.userId)).toBe(false);
    expect(notified[0].title).toBe("New enquiry from Karan Malhotra");
    expect((notified[0].data as { href?: string }).href).toBe(`/${uni.slug}/admin/website/sections/enquiries/${res.id}`);
  });

  it("rejects the honeypot: nothing is saved and nothing is emitted", async () => {
    const { uni } = await siteFixture("Honeypot U");
    const before = (await eventsOfType("enquiry.received", uni.id)).length;
    const res = await submitEnquiry(uni.id, { ...valid, website: "http://spam.example" }, { ip: freshIp() });
    expect(res).toEqual({ status: "ignored" });
    expect(await systemDb().select().from(siteEnquiries).where(eq(siteEnquiries.universityId, uni.id))).toEqual([]);
    expect(await systemDb().select().from(siteSubmissions).where(eq(siteSubmissions.universityId, uni.id))).toEqual([]);
    expect((await eventsOfType("enquiry.received", uni.id)).length).toBe(before);

    // Reviews have the same trap.
    expect(await submitReview(uni.id, { name: "Bot", email: "bot@example.com", rating: 5, body: "Great great great great great.", website: "x" }, { ip: freshIp() })).toEqual({ status: "ignored" });
    expect(await systemDb().select().from(siteReviews).where(eq(siteReviews.universityId, uni.id))).toEqual([]);
  });

  it("rate-limits each sender, per hour, without affecting other senders", async () => {
    const { uni } = await siteFixture("Rate Limit U");
    const ip = freshIp();
    const now = new Date();
    for (let i = 0; i < RATE_LIMITS.enquiry.perSender; i++) {
      expect((await submitEnquiry(uni.id, valid, { ip, now })).status).toBe("saved");
    }
    await expect(submitEnquiry(uni.id, valid, { ip, now })).rejects.toThrow(/several enquiries in the last hour/);
    // Someone else is fine.
    expect((await submitEnquiry(uni.id, valid, { ip: freshIp(), now })).status).toBe("saved");
    // An hour later the sender may write again.
    expect((await submitEnquiry(uni.id, valid, { ip, now: new Date(now.getTime() + 61 * 60_000) })).status).toBe("saved");
    // The refused attempt saved nothing.
    expect(await systemDb().select().from(siteEnquiries).where(eq(siteEnquiries.universityId, uni.id))).toHaveLength(RATE_LIMITS.enquiry.perSender + 2);
    // Only an HMAC of the IP is stored.
    const rows = await systemDb().select().from(siteSubmissions).where(eq(siteSubmissions.universityId, uni.id));
    expect(rows.every((r) => !r.fingerprint.includes(ip))).toBe(true);
    expect(rows.filter((r) => r.fingerprint === fingerprint(ip))).toHaveLength(RATE_LIMITS.enquiry.perSender + 1);
  });

  it("caps a whole site's enquiries per hour, so a flood can't bury the inbox", async () => {
    const { uni } = await siteFixture("Flood U");
    const now = new Date();
    await systemDb()
      .insert(siteSubmissions)
      .values(Array.from({ length: RATE_LIMITS.enquiry.perSite }, (_, i) => ({ universityId: uni.id, kind: "enquiry" as const, fingerprint: `f${i}`, createdAt: now })));
    await expect(submitEnquiry(uni.id, valid, { ip: freshIp(), now })).rejects.toThrow(/a lot of enquiries right now/);
    // Another site is unaffected.
    const other = await siteFixture("Calm U");
    expect((await submitEnquiry(other.uni.id, valid, { ip: freshIp(), now })).status).toBe("saved");
  });

  it("reviews are rate-limited too", async () => {
    const { uni } = await siteFixture("Review Limit U");
    const ip = freshIp();
    const r = { name: "Repeat Ravi", email: "ravi@example.com", rating: 5, body: "A very good course with great faculty." };
    for (let i = 0; i < RATE_LIMITS.review.perSender; i++) expect((await submitReview(uni.id, r, { ip })).status).toBe("saved");
    await expect(submitReview(uni.id, r, { ip })).rejects.toThrow(/several reviews in the last hour/);
  });

  it("checks what people type, and says how to fix it", async () => {
    const { uni } = await siteFixture("Validation U");
    await expect(submitEnquiry(uni.id, { ...valid, email: "not-an-email" }, { ip: freshIp() })).rejects.toThrow(/doesn't look like an email/);
    await expect(submitEnquiry(uni.id, { ...valid, email: "" }, { ip: freshIp() })).rejects.toThrow(/Add an email/);
    await expect(submitEnquiry(uni.id, { ...valid, name: "K" }, { ip: freshIp() })).rejects.toThrow(/at least 2 characters/);
    await expect(submitEnquiry(uni.id, { ...valid, phone: "call me" }, { ip: freshIp() })).rejects.toThrow(/phone number/);
    await expect(submitEnquiry(uni.id, { ...valid, message: "x".repeat(2001) }, { ip: freshIp() })).rejects.toThrow(/at most 2000/);
    await expect(submitReview(uni.id, { name: "Ann", email: "a@example.com", rating: 7, body: "Lovely place to learn things." }, { ip: freshIp() })).rejects.toThrow(/1 to 5/);
    // A failed check doesn't use up the sender's allowance.
    expect(await systemDb().select().from(siteSubmissions).where(eq(siteSubmissions.universityId, uni.id))).toEqual([]);
  });
});

describe("website-builder: the enquiries inbox", () => {
  it("statuses, assignee and notes build a history; the assignee is notified", async () => {
    const { uni, admin } = await siteFixture("Inbox U");
    const colleague = await (await person("Colleague Admin", "institute_admin", { universityId: uni.id })).actor();
    const res = await submitEnquiry(uni.id, valid, { ip: freshIp() });
    if (res.status !== "saved") throw new Error("not saved");

    await assignEnquiry(admin, res.id, colleague.userId, { slug: uni.slug });
    await addEnquiryNote(admin, res.id, "Called, no answer. Will try again tomorrow.");
    await setEnquiryStatus(admin, res.id, "contacted");
    const e = await getEnquiry(admin, res.id);
    expect(e.status).toBe("contacted");
    expect(e.assigneeName).toBe("Colleague Admin");
    expect(e.notes.map((n) => [n.kind, n.body])).toEqual([
      ["assignee", "Assigned to Colleague Admin."],
      ["note", "Called, no answer. Will try again tomorrow."],
      ["status", "Marked as contacted."],
    ]);
    expect(e.assignees.map((p) => p.name)).toEqual(["Admin Asha", "Colleague Admin"]);
    const [n] = await systemDb().select().from(notifications).where(and(eq(notifications.userId, colleague.userId), eq(notifications.kind, "website.enquiry_assigned")));
    expect(n.title).toBe("Admin Asha gave you an enquiry from Karan Malhotra");

    expect((await listEnquiries(admin, { status: "new" })).rows).toEqual([]);
    expect((await listEnquiries(admin, { status: "contacted" })).rows.map((r) => r.id)).toEqual([res.id]);
    expect((await listEnquiries(colleague, { status: "all", assignee: "me" })).rows.map((r) => r.id)).toEqual([res.id]);
    expect((await listEnquiries(admin, { status: "all", assignee: "me" })).rows).toEqual([]);
    expect((await listEnquiries(admin, { status: "all" })).counts).toEqual({ contacted: 1 });
  });

  it("only people who manage the website can be assigned an enquiry", async () => {
    const { uni, admin, hod } = await siteFixture("Assign U");
    const res = await submitEnquiry(uni.id, valid, { ip: freshIp() });
    if (res.status !== "saved") throw new Error("not saved");
    await expect(assignEnquiry(admin, res.id, hod.userId)).rejects.toThrow(/people who manage the website/);
    await assignEnquiry(admin, res.id, null);
  });

  it("allow and deny: website managers work the inbox; others can't see it", async () => {
    const { uni, admin, hod, faculty, board, studentActor } = await siteFixture("Inbox Perms U");
    const res = await submitEnquiry(uni.id, valid, { ip: freshIp() });
    if (res.status !== "saved") throw new Error("not saved");
    expect((await listEnquiries(admin)).rows).toHaveLength(1);
    for (const who of [hod, faculty, board, studentActor]) {
      await expect(listEnquiries(who)).rejects.toThrow(/access/);
      await expect(getEnquiry(who, res.id)).rejects.toThrow(/access/);
      await expect(setEnquiryStatus(who, res.id, "closed")).rejects.toThrow(/access/);
      await expect(addEnquiryNote(who, res.id, "Sneaky note")).rejects.toThrow(/access/);
    }
  });
});
