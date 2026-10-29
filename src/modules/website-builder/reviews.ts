/**
 * Reviews: visitors send them from the public site; they wait for an admin, who approves
 * (shown on the site) or hides them. Hidden and waiting reviews, and every reviewer's
 * email, never reach the public site.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses } from "@/db/schema";
import { audit, notify, systemActorFor, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertManage, websiteManagerIds } from "./access";
import { fingerprint, takeSubmissionSlot } from "./rate-limit";
import { siteReviews } from "./schema";
import { cleanEmail, isUuid, requireText } from "./validate";

export type ReviewStatus = "pending" | "approved" | "hidden";

export type ReviewSubmission = {
  name?: string;
  email?: string;
  rating?: number | string;
  body?: string;
  courseId?: string | null;
  /** The honeypot: people never see this field; bots fill it in. */
  website?: string;
};

export type SubmitMeta = { ip?: string | null; now?: Date; slug?: string };

export type SubmitResult = { status: "saved"; id: string } | { status: "ignored" };

function cleanRating(v: ReviewSubmission["rating"]): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new ValidationError("Choose a rating from 1 to 5 stars.");
  return n;
}

/** A published course of this university, or null. A course id from elsewhere is ignored. */
export async function publishedCourseId(tx: Tx, courseId: string | null | undefined) {
  if (!courseId || !isUuid(courseId)) return null;
  const [c] = await tx.select({ id: courses.id }).from(courses).where(and(eq(courses.id, courseId), eq(courses.status, "published")));
  return c?.id ?? null;
}

/** From the public site. Public: no signed-in person, so it runs as the university's system actor. */
export async function submitReview(universityId: string, input: ReviewSubmission, meta: SubmitMeta = {}): Promise<SubmitResult> {
  if ((input.website ?? "").trim() !== "") return { status: "ignored" };
  const values = {
    authorName: requireText(input.name, "Your name", { min: 2, max: 80 }),
    authorEmail: cleanEmail(input.email, { required: true }),
    rating: cleanRating(input.rating),
    body: requireText(input.body, "Your review", { min: 20, max: 1500 }),
  };
  const system = systemActorFor(universityId);
  return withTenant(system, async (tx) => {
    await takeSubmissionSlot(tx, universityId, "review", fingerprint(meta.ip), meta.now);
    const courseId = await publishedCourseId(tx, input.courseId);
    const [row] = await tx.insert(siteReviews).values({ universityId, ...values, courseId, status: "pending" }).returning();
    await audit(tx, system, "site.review_received", "site_review", row.id, { rating: row.rating, courseId });
    await notify(tx, universityId, await websiteManagerIds(tx, universityId), {
      kind: "website.review",
      title: `New ${row.rating}-star review from ${row.authorName}`,
      body: "Approve it to show it on your website, or hide it.",
      data: { reviewId: row.id, href: meta.slug ? `/${meta.slug}/admin/website/sections/reviews` : undefined },
    });
    return { status: "saved", id: row.id };
  });
}

export async function listReviews(actor: Actor, status: ReviewStatus | "all" = "pending") {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({ review: siteReviews, courseTitle: courses.title })
      .from(siteReviews)
      .leftJoin(courses, eq(courses.id, siteReviews.courseId))
      .where(status === "all" ? undefined : eq(siteReviews.status, status))
      .orderBy(desc(siteReviews.createdAt));
    const counts = await tx
      .select({ status: siteReviews.status, n: sql<number>`count(*)::int`, avg: sql<number>`avg(${siteReviews.rating})::float` })
      .from(siteReviews)
      .groupBy(siteReviews.status);
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<ReviewStatus, number>> };
  });
}

/** Approve (show on the site) or hide a review. */
export async function moderateReview(actor: Actor, id: string, decision: "approve" | "hide") {
  assertManage(actor);
  if (!isUuid(id)) throw new NotFoundError("Review");
  return withTenant(actor, async (tx) => {
    const [r] = await tx.select().from(siteReviews).where(eq(siteReviews.id, id));
    if (!r) throw new NotFoundError("Review");
    const status: ReviewStatus = decision === "approve" ? "approved" : "hidden";
    const [row] = await tx
      .update(siteReviews)
      .set({ status, moderatedAt: new Date(), moderatedBy: actor.userId || null })
      .where(eq(siteReviews.id, id))
      .returning();
    await audit(tx, actor, decision === "approve" ? "site.approve_review" : "site.hide_review", "site_review", id, { from: r.status });
    return row;
  });
}

export async function deleteReview(actor: Actor, id: string) {
  assertManage(actor);
  if (!isUuid(id)) throw new NotFoundError("Review");
  await withTenant(actor, async (tx) => {
    const [r] = await tx.delete(siteReviews).where(eq(siteReviews.id, id)).returning({ id: siteReviews.id });
    if (!r) throw new NotFoundError("Review");
    await audit(tx, actor, "site.delete_review", "site_review", id, {});
  });
}
