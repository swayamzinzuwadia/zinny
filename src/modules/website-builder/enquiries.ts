/**
 * Enquiries: the form on the public site, and the admin inbox (new → contacted → closed,
 * an assignee, and a history of notes). A new enquiry emits `enquiry.received` and notifies
 * everyone who manages the website.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses } from "@/db/schema";
import { audit, emit, notify, peopleLite, systemActorFor, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertManage, websiteManagerIds, websiteManagers } from "./access";
import { fingerprint, takeSubmissionSlot } from "./rate-limit";
import { publishedCourseId, type SubmitMeta, type SubmitResult } from "./reviews";
import { siteEnquiries, siteEnquiryNotes } from "./schema";
import { cleanEmail, cleanPhone, isUuid, optionalText, requireText } from "./validate";

export type EnquiryStatus = "new" | "contacted" | "closed";
export const ENQUIRY_STATUSES: EnquiryStatus[] = ["new", "contacted", "closed"];
export const ENQUIRY_STATUS_LABEL: Record<EnquiryStatus, string> = { new: "New", contacted: "Contacted", closed: "Closed" };

export type EnquirySubmission = {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  courseId?: string | null;
  source?: string;
  /** The honeypot: hidden from people, filled in by bots. */
  website?: string;
};

/**
 * From the public site. There is no signed-in person, so it runs as the university's system
 * actor. Bots that fill in the hidden field get a normal-looking answer but nothing is saved.
 */
export async function submitEnquiry(universityId: string, input: EnquirySubmission, meta: SubmitMeta = {}): Promise<SubmitResult> {
  if ((input.website ?? "").trim() !== "") return { status: "ignored" };
  const values = {
    name: requireText(input.name, "Your name", { min: 2, max: 80 }),
    email: cleanEmail(input.email, { required: true }),
    phone: cleanPhone(input.phone, { required: false }) || null,
    message: optionalText(input.message, "Your message", 2000),
    source: input.source === "course" ? "course" : "home",
  };
  const system = systemActorFor(universityId);
  return withTenant(system, async (tx) => {
    await takeSubmissionSlot(tx, universityId, "enquiry", fingerprint(meta.ip), meta.now);
    const courseId = await publishedCourseId(tx, input.courseId);
    const [row] = await tx.insert(siteEnquiries).values({ universityId, ...values, courseId }).returning();
    await audit(tx, system, "site.enquiry_received", "site_enquiry", row.id, { courseId, source: row.source });
    await emit(tx, system, "enquiry.received", { enquiryId: row.id, name: row.name, email: row.email, phone: row.phone });
    const [course] = courseId ? await tx.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId)) : [];
    await notify(tx, universityId, await websiteManagerIds(tx, universityId), {
      kind: "website.enquiry",
      title: `New enquiry from ${row.name}`,
      body: course ? `About ${course.title}.` : row.message.slice(0, 140),
      data: { enquiryId: row.id, href: meta.slug ? `/${meta.slug}/admin/website/sections/enquiries/${row.id}` : undefined },
    });
    return { status: "saved", id: row.id };
  });
}

export type EnquiryFilter = { status?: EnquiryStatus | "all"; assignee?: "me" | "unassigned" | "anyone" };

export async function listEnquiries(actor: Actor, filter: EnquiryFilter = {}) {
  assertManage(actor);
  const status = filter.status ?? "new";
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({ enquiry: siteEnquiries, courseTitle: courses.title })
      .from(siteEnquiries)
      .leftJoin(courses, eq(courses.id, siteEnquiries.courseId))
      .where(
        and(
          status === "all" ? undefined : eq(siteEnquiries.status, status),
          filter.assignee === "me" ? eq(siteEnquiries.assigneeUserId, actor.userId) : undefined,
          filter.assignee === "unassigned" ? sql`${siteEnquiries.assigneeUserId} is null` : undefined,
        ),
      )
      .orderBy(desc(siteEnquiries.createdAt))
      .limit(500);
    const people = await peopleLite(tx, rows.flatMap((r) => (r.enquiry.assigneeUserId ? [r.enquiry.assigneeUserId] : [])));
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const counts = await tx.select({ status: siteEnquiries.status, n: sql<number>`count(*)::int` }).from(siteEnquiries).groupBy(siteEnquiries.status);
    return {
      rows: rows.map((r) => ({ ...r.enquiry, courseTitle: r.courseTitle, assigneeName: r.enquiry.assigneeUserId ? (nameOf.get(r.enquiry.assigneeUserId) ?? "Former staff") : null })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<EnquiryStatus, number>>,
    };
  });
}

export async function getEnquiry(actor: Actor, id: string) {
  assertManage(actor);
  if (!isUuid(id)) throw new NotFoundError("Enquiry");
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .select({ enquiry: siteEnquiries, courseTitle: courses.title })
      .from(siteEnquiries)
      .leftJoin(courses, eq(courses.id, siteEnquiries.courseId))
      .where(eq(siteEnquiries.id, id));
    if (!row) throw new NotFoundError("Enquiry");
    const notes = await tx.select().from(siteEnquiryNotes).where(eq(siteEnquiryNotes.enquiryId, id)).orderBy(asc(siteEnquiryNotes.createdAt));
    const people = await peopleLite(tx, [
      ...notes.flatMap((n) => (n.authorUserId ? [n.authorUserId] : [])),
      ...(row.enquiry.assigneeUserId ? [row.enquiry.assigneeUserId] : []),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    return {
      ...row.enquiry,
      courseTitle: row.courseTitle,
      assigneeName: row.enquiry.assigneeUserId ? (nameOf.get(row.enquiry.assigneeUserId) ?? "Former staff") : null,
      notes: notes.map((n) => ({ ...n, authorName: n.authorUserId ? (nameOf.get(n.authorUserId) ?? "Former staff") : "Zinny" })),
      assignees: await websiteManagers(tx, actor.universityId!),
    };
  });
}

async function loadForUpdate(tx: Tx, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Enquiry");
  const [row] = await tx.select().from(siteEnquiries).where(eq(siteEnquiries.id, id)).for("update");
  if (!row) throw new NotFoundError("Enquiry");
  return row;
}

export async function setEnquiryStatus(actor: Actor, id: string, status: EnquiryStatus) {
  const universityId = assertManage(actor);
  if (!ENQUIRY_STATUSES.includes(status)) throw new ValidationError("Pick New, Contacted or Closed.");
  return withTenant(actor, async (tx) => {
    const row = await loadForUpdate(tx, id);
    if (row.status === status) return row;
    const [saved] = await tx.update(siteEnquiries).set({ status, updatedAt: new Date() }).where(eq(siteEnquiries.id, id)).returning();
    await tx.insert(siteEnquiryNotes).values({
      universityId,
      enquiryId: id,
      kind: "status",
      body: `Marked as ${ENQUIRY_STATUS_LABEL[status].toLowerCase()}.`,
      authorUserId: actor.userId || null,
    });
    await audit(tx, actor, "site.enquiry_status", "site_enquiry", id, { from: row.status, to: status });
    return saved;
  });
}

/** Give the enquiry to someone who manages the website (or to nobody). They are notified. */
export async function assignEnquiry(actor: Actor, id: string, assigneeUserId: string | null, opts: { slug?: string } = {}) {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const row = await loadForUpdate(tx, id);
    const target = assigneeUserId || null;
    if (target && !(await websiteManagerIds(tx, universityId)).includes(target)) {
      throw new ValidationError("Enquiries can only go to people who manage the website. Pick someone from the list.");
    }
    if (row.assigneeUserId === target) return row;
    const [saved] = await tx.update(siteEnquiries).set({ assigneeUserId: target, updatedAt: new Date() }).where(eq(siteEnquiries.id, id)).returning();
    const [person] = target ? await peopleLite(tx, [target]) : [];
    await tx.insert(siteEnquiryNotes).values({
      universityId,
      enquiryId: id,
      kind: "assignee",
      body: person ? `Assigned to ${person.name}.` : "Unassigned.",
      authorUserId: actor.userId || null,
    });
    if (target && target !== actor.userId) {
      await notify(tx, universityId, [target], {
        kind: "website.enquiry_assigned",
        title: `${actor.name || "Someone"} gave you an enquiry from ${row.name}`,
        body: row.message.slice(0, 140),
        data: { enquiryId: id, href: opts.slug ? `/${opts.slug}/admin/website/sections/enquiries/${id}` : undefined },
      });
    }
    await audit(tx, actor, "site.enquiry_assign", "site_enquiry", id, { from: row.assigneeUserId, to: target });
    return saved;
  });
}

export async function addEnquiryNote(actor: Actor, id: string, body: string) {
  const universityId = assertManage(actor);
  const text = requireText(body, "The note", { min: 2, max: 2000 });
  return withTenant(actor, async (tx) => {
    await loadForUpdate(tx, id);
    const [note] = await tx.insert(siteEnquiryNotes).values({ universityId, enquiryId: id, kind: "note", body: text, authorUserId: actor.userId || null }).returning();
    await tx.update(siteEnquiries).set({ updatedAt: new Date() }).where(eq(siteEnquiries.id, id));
    await audit(tx, actor, "site.enquiry_note", "site_enquiry", id, {});
    return note;
  });
}

/** How many enquiries are in each status. */
export async function enquiryCounts(actor: Actor) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const rows = await tx.select({ status: siteEnquiries.status, n: sql<number>`count(*)::int` }).from(siteEnquiries).where(inArray(siteEnquiries.status, ENQUIRY_STATUSES)).groupBy(siteEnquiries.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<EnquiryStatus, number>>;
  });
}
