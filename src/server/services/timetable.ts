/**
 * Student timetable (PRD page 6): built automatically from the batches a student
 * picked. Nothing is stored — it is computed on every request, so a batch switch
 * or a timing change shows up instantly.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { enrolments, parentLinks, roleAssignments, universities, users } from "@/db/schema";
import { assertCan, can, type Actor } from "../authz/engine";
import { NotFoundError } from "../errors";
import { addDays, todayIn, weekStart } from "../lib/dates";
import { withTenant } from "../tenant";
import { annotateWithPlansTx } from "./batch-plan";
import { scheduledBatches } from "./batches";
import { expandSessions, markClashes } from "./schedule";

async function tzOf(tx: Tx, universityId: string) {
  const [u] = await tx.select({ tz: universities.timezone }).from(universities).where(eq(universities.id, universityId));
  return u?.tz ?? "Asia/Kolkata";
}

export async function studentTimetable(actor: Actor, range?: { from: string; to: string }, forUserId?: string) {
  const ownerUserId = forUserId ?? actor.userId;
  if (ownerUserId === actor.userId) {
    assertCan(actor, "self.view_learning", { universityId: actor.universityId!, ownerUserId });
  } else {
    assertCan(actor, "parent.view_child", { universityId: actor.universityId! });
  }
  return withTenant(actor, async (tx) => {
    if (ownerUserId !== actor.userId) {
      const [link] = await tx
        .select()
        .from(parentLinks)
        .where(and(eq(parentLinks.parentUserId, actor.userId), eq(parentLinks.studentUserId, ownerUserId)));
      if (!link) throw new NotFoundError("Student");
    }
    const today = todayIn(await tzOf(tx, actor.universityId!));
    const from = range?.from ?? weekStart(today);
    const to = range?.to ?? addDays(from, 6);
    const rows = await tx
      .select({ batchId: enrolments.batchId })
      .from(enrolments)
      .where(and(eq(enrolments.userId, ownerUserId), eq(enrolments.status, "active")));
    const sched = await scheduledBatches(tx, rows.map((r) => r.batchId));
    // Classes of two batches at the same time are marked: the student joined despite the warning.
    return { today, from, to, sessions: markClashes(await annotateWithPlansTx(tx, actor.universityId!, sched, expandSessions(sched, from, to))) };
  });
}

/** Faculty see the classes of the batches they teach, each with its section; `taughtByMe` marks their own sections. */
export async function facultyTimetable(actor: Actor, range?: { from: string; to: string }) {
  return withTenant(actor, async (tx) => {
    const now = new Date();
    const mine = (
      await tx
        .select()
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, actor.userId),
            eq(roleAssignments.scopeType, "batch"),
            inArray(roleAssignments.role, ["permanent_faculty", "visiting_faculty"]),
            isNull(roleAssignments.revokedAt),
          ),
        )
    ).filter((a) => !a.endsAt || a.endsAt > now);
    const today = todayIn(await tzOf(tx, actor.universityId!));
    const from = range?.from ?? weekStart(today);
    const to = range?.to ?? addDays(from, 6);
    // Only batches they may still open: a role that hasn't started yet or lost "view" shows nothing.
    const sched = (await scheduledBatches(tx, [...new Set(mine.map((a) => a.batchId!))])).filter((b) =>
      can(actor, "batch.view", { universityId: actor.universityId!, departmentIds: [b.departmentId], batchIds: [b.batchId] }),
    );
    return { today, from, to, sessions: await annotateWithPlansTx(tx, actor.universityId!, sched, expandSessions(sched, from, to), actor.userId) };
  });
}

/** Students linked to this parent (read-only view, PRD page 7). */
export async function myChildren(actor: Actor) {
  assertCan(actor, "parent.view_child", { universityId: actor.universityId! });
  return withTenant(actor, (tx) =>
    tx
      .select({ id: users.id, name: users.name })
      .from(parentLinks)
      .innerJoin(users, eq(users.id, parentLinks.studentUserId))
      .where(eq(parentLinks.parentUserId, actor.userId)),
  );
}
