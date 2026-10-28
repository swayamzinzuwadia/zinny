/**
 * Student timetable (PRD page 6): built automatically from the batches a student
 * picked. Nothing is stored — it is computed on every request, so a batch switch
 * or a timing change shows up instantly.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { enrolments, parentLinks, roleAssignments, universities, users } from "@/db/schema";
import { assertCan, type Actor } from "../authz/engine";
import { NotFoundError } from "../errors";
import { addDays, todayIn, weekStart } from "../lib/dates";
import { withTenant } from "../tenant";
import { scheduledBatches } from "./batches";
import { expandSessions } from "./schedule";

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
    return { today, from, to, sessions: expandSessions(sched, from, to) };
  });
}

/** Faculty see the classes of the batches they teach. */
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
    const sched = await scheduledBatches(tx, mine.map((a) => a.batchId!));
    return { today, from, to, sessions: expandSessions(sched, from, to) };
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
