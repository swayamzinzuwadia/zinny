import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments } from "@/db/schema";
import { SlotList, SlotOutlet } from "@/components/slots";
import { batchLite, getCourseLite, systemActorFor, universityLite, withTenant } from "@/server/core";
import { jobs, eventHandlers, visibleSlots } from "@/server/registry";
import { markLessonComplete } from "@/modules/content-progress/learn";
import { contentCourseProgress } from "@/modules/content-progress/schema";
import { completeFinishedEnrolments } from "@/modules/content-progress/events";
import { setupLearning, tempStorage } from "./helpers";

let restore: () => void;
beforeAll(() => {
  restore = tempStorage();
});
afterAll(async () => {
  restore();
  await closeDb();
});

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "");
}

describe("learner slots", () => {
  it("learnerCourseTabs.lessons shows the outline, progress and what's next", async () => {
    const ctx = await setupLearning({
      name: "Lessons Tab U",
      lessons: [
        { title: "First lesson", kind: "text" },
        { title: "Second lesson", kind: "link" },
        { title: "Later lesson", kind: "text", drip: { mode: "after_start", days: 300 } },
      ],
    });
    const s = await ctx.enrolled("Student Tab");
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    const target = { universityId: ctx.uni.id, departmentIds: [ctx.dept.id], batchIds: [ctx.batch.id], ownerUserId: s.userId };
    const tab = visibleSlots("learnerCourseTabs", s.actor, target).find((t) => t.key === "lessons")!;
    expect(tab).toMatchObject({ label: "Lessons", order: 100 });
    expect(visibleSlots("learnerCourseTabs", ctx.hod, { ...target, ownerUserId: ctx.hod.userId }).find((t) => t.key === "lessons")).toBeUndefined();
    const props = await withTenant(s.actor, async (tx) => ({
      university: await universityLite(tx),
      course: await getCourseLite(tx, ctx.course.id),
      batch: await batchLite(tx, ctx.batch.id),
    }));
    const out = await html(
      <SlotOutlet
        slot="learnerCourseTabs"
        entry={tab}
        props={{
          uni: ctx.uni.slug,
          actor: s.actor,
          ...props,
          enrolment: { enrolmentId: s.enrolmentId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" },
          target,
          searchParams: {},
        }}
      />,
    );
    expect(out).toContain("First lesson");
    expect(out).toContain("Second lesson");
    expect(out).toContain("1 of 3 required lessons");
    expect(out).toContain("Up next");
    expect(out).toMatch(/Opens \w{3}, \d+ \w{3}/);
    expect(out).toContain(`/${ctx.uni.slug}/learn/lessons/${ctx.lessons[1].id}`);
  });

  it("learnerHomeCards.continue-learning shows the next unfinished lesson, and nothing without courses", async () => {
    const ctx = await setupLearning({ name: "Continue Card U", lessons: [{ title: "Opening talk", kind: "text" }, { title: "Second talk", kind: "text" }] });
    const s = await ctx.enrolled("Student Card");
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    const own = { universityId: ctx.uni.id, ownerUserId: s.userId };
    const entries = visibleSlots("learnerHomeCards", s.actor, own).filter((e) => e.key === "continue-learning");
    expect(entries).toHaveLength(1);
    expect(entries[0].order).toBe(100);
    const university = await withTenant(s.actor, (tx) => universityLite(tx));
    const out = await html(<SlotList slot="learnerHomeCards" entries={entries} props={{ uni: ctx.uni.slug, actor: s.actor, university, today: "2026-10-29" }} />);
    expect(out).toContain("Continue learning");
    expect(out).toContain("Second talk");
    expect(out).toContain(ctx.course.title);
    const newcomer = await ctx.student("Not Enrolled Yet");
    const empty = await html(<SlotList slot="learnerHomeCards" entries={entries} props={{ uni: ctx.uni.slug, actor: newcomer, university, today: "2026-10-29" }} />);
    expect(empty).toBe("");
  });
});

describe("handlers and jobs", () => {
  it("are registered under content-progress ids", () => {
    expect(eventHandlers().map((h) => h.id)).toEqual(
      expect.arrayContaining(["content-progress.complete-at-100", "content-progress.record-completion", "content-progress.count-earlier-lessons"]),
    );
    expect(jobs().map((j) => j.id)).toEqual(expect.arrayContaining(["content-progress.complete-finished", "content-progress.clean-uploads"]));
  });

  it("the safety nets complete an enrolment left at 100% when completing was interrupted, exactly once", async () => {
    const { drainEvents, eventsOfType } = await import("../helpers/events");
    const { completeLessonTx } = await import("@/modules/content-progress/engine");
    const for100 = async (name: string) => {
      const ctx = await setupLearning({ name, lessons: [{ title: "Only lesson", kind: "text" }] });
      const s = await ctx.enrolled("Student Net");
      // The progress commits at 100%, but the step after it (completing through core) never runs.
      await withTenant(s.actor, (tx) =>
        completeLessonTx(tx, s.actor, {
          universityId: ctx.uni.id,
          enrolment: { enrolmentId: s.enrolmentId, userId: s.userId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "active" },
          lessonId: ctx.lessons[0].id,
          via: "manual",
        }),
      );
      const [before] = await systemDb().select().from(enrolments).where(eq(enrolments.id, s.enrolmentId));
      expect(before.status).toBe("active");
      return { ctx, s };
    };
    const completedEvents = async (uniId: string, enrolmentId: string) =>
      (await eventsOfType("enrolment.completed", uniId)).filter((x) => (x.payload as { enrolmentId: string }).enrolmentId === enrolmentId);

    // 1. The course.progress handler (delivered from the outbox).
    const a = await for100("Safety Net Handler U");
    await drainEvents();
    await drainEvents();
    expect((await systemDb().select().from(enrolments).where(eq(enrolments.id, a.s.enrolmentId)))[0].status).toBe("completed");
    expect(await completedEvents(a.ctx.uni.id, a.s.enrolmentId)).toHaveLength(1);
    const [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, a.s.enrolmentId));
    expect(row.completedAt).not.toBeNull();

    // 2. The hourly job, before any delivery; then the handler finds it already done.
    const b = await for100("Safety Net Job U");
    await completeFinishedEnrolments(systemActorFor(b.ctx.uni.id));
    await completeFinishedEnrolments(systemActorFor(b.ctx.uni.id));
    await drainEvents();
    expect((await systemDb().select().from(enrolments).where(eq(enrolments.id, b.s.enrolmentId)))[0].status).toBe("completed");
    expect(await completedEvents(b.ctx.uni.id, b.s.enrolmentId)).toHaveLength(1);
  });
});
