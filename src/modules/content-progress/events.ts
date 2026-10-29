/**
 * Event handlers and jobs.
 *
 * - course.progress at 100%: the safety net for course completion. The player completes
 *   the enrolment right after the progress commits; this handler (delivered at least once
 *   from the outbox, in the same transaction as the progress) makes sure it happens even
 *   if that step was interrupted. Core's markEnrolmentCompleted is idempotent.
 * - enrolment.completed: records when the course was completed on the progress row
 *   (also for courses staff marked complete).
 * - enrolment.confirmed: counts lessons the learner already finished in this course
 *   (progress belongs to the learner, so a re-enrolment keeps it).
 */
import { and, eq, gte } from "drizzle-orm";
import { defineHandler, type EventHandler } from "@/contracts/events";
import type { Job } from "@/contracts/module";
import { enrolments } from "@/db/schema";
import { audit, enrolmentById, withTenant, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { finishCompletions, lockCourseProgress, syncCourseProgress } from "./engine";
import { contentCourseProgress } from "./schema";
import { cleanAbandonedUploads } from "./uploads";

export const handlers: EventHandler[] = [
  defineHandler({
    id: "content-progress.complete-at-100",
    on: ["course.progress"],
    handle: async ({ actor, event }) => {
      if (!event.universityId || event.payload.percent < 100) return;
      const [r] = await finishCompletions(event.universityId, [event.payload.enrolmentId]);
      if (r?.status === "skipped") {
        // Skipped means "not active any more" (fine) or a failure (retry): tell them apart.
        const still = await withTenant(actor, (tx) => enrolmentById(tx, event.payload.enrolmentId)).catch((e) => {
          if (e instanceof NotFoundError) return null;
          throw e;
        });
        if (still?.status === "active") throw new Error("Completing the enrolment failed; it will be retried.");
      }
    },
  }),
  defineHandler({
    id: "content-progress.record-completion",
    on: ["enrolment.completed"],
    handle: async ({ tx, event }) => {
      if (!event.universityId) return;
      const p = event.payload;
      await tx
        .insert(contentCourseProgress)
        .values({ universityId: event.universityId, enrolmentId: p.enrolmentId, userId: p.userId, courseId: p.courseId, completedAt: event.occurredAt })
        .onConflictDoUpdate({ target: contentCourseProgress.enrolmentId, set: { completedAt: event.occurredAt, updatedAt: new Date() } });
    },
  }),
  defineHandler({
    id: "content-progress.count-earlier-lessons",
    on: ["enrolment.confirmed"],
    handle: async ({ tx, actor, event }) => {
      if (!event.universityId) return;
      const p = event.payload;
      const e = await enrolmentById(tx, p.enrolmentId).catch((err) => {
        if (err instanceof NotFoundError) return null;
        throw err;
      });
      if (!e || e.status !== "active") return;
      const row = await lockCourseProgress(tx, event.universityId, e);
      // Reaching 100% here emits course.progress, whose handler completes the enrolment.
      await syncCourseProgress(tx, actor, row, e);
    },
  }),
];

/** Active enrolments stored at 100%: recount them and complete the ones still there. */
export async function completeFinishedEnrolments(actor: Actor) {
  const universityId = actor.universityId!;
  const finished = await withTenant(actor, async (tx) => {
    const candidates = await tx
      .select({ enrolmentId: enrolments.id, userId: enrolments.userId, courseId: enrolments.courseId, batchId: enrolments.batchId, status: enrolments.status })
      .from(contentCourseProgress)
      .innerJoin(enrolments, eq(enrolments.id, contentCourseProgress.enrolmentId))
      .where(and(gte(contentCourseProgress.percent, 100), eq(enrolments.status, "active")));
    const out: string[] = [];
    for (const e of candidates) {
      const row = await lockCourseProgress(tx, universityId, e);
      const r = await syncCourseProgress(tx, actor, row, e);
      if (r.reached100) out.push(e.enrolmentId);
    }
    if (out.length) await audit(tx, actor, "content.completion_sweep", "university", universityId, { enrolments: out.length });
    return out;
  });
  return finishCompletions(universityId, finished);
}

export const jobs: Job[] = [
  { id: "content-progress.complete-finished", every: "hour", run: async (actor) => void (await completeFinishedEnrolments(actor)) },
  { id: "content-progress.clean-uploads", every: "day", run: async (actor) => void (await cleanAbandonedUploads(actor)) },
];

