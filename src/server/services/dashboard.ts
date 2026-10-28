import { and, eq, inArray, sql } from "drizzle-orm";
import { batches, enrolments } from "@/db/schema";
import { can, reach, type Actor } from "../authz/engine";
import { withTenant } from "../tenant";
import { listCourses } from "./courses";

/** Numbers for the dashboard, limited to what this person can see. */
export async function dashboardStats(actor: Actor) {
  const uni = actor.universityId!;
  const courses = await listCourses(actor);
  const r = reach(actor, "batch.view", uni);
  const stats = await withTenant(actor, async (tx) => {
    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) return { openBatches: 0, activeStudents: 0 };
    const visibleBatches = await tx
      .select({ id: batches.id, departmentId: batches.departmentId, status: batches.status })
      .from(batches)
      .where(inArray(batches.courseId, courseIds));
    const mine = visibleBatches.filter((b) => r.all || r.departmentIds.has(b.departmentId) || r.batchIds.has(b.id));
    const ids = mine.map((b) => b.id);
    const [{ n }] = ids.length
      ? await tx
          .select({ n: sql<number>`count(distinct ${enrolments.userId})::int` })
          .from(enrolments)
          .where(and(inArray(enrolments.batchId, ids), eq(enrolments.status, "active")))
      : [{ n: 0 }];
    return { openBatches: mine.filter((b) => b.status === "open").length, activeStudents: n };
  });
  return {
    courses: courses.length,
    published: courses.filter((c) => c.status === "published").length,
    ...stats,
    canDecideSwitches: reach(actor, "batch.switch.decide", uni).all || reach(actor, "batch.switch.decide", uni).departmentIds.size > 0,
    canSeeFinance: can(actor, "finance.view", { universityId: uni }),
  };
}
