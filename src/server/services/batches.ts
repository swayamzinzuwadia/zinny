/**
 * Batches (PRD pages 5 and 7). Each batch needs a name, days and timings, start and
 * end date, seat limit and at least one faculty member. Faculty are assigned to
 * batches, not whole courses.
 */
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  batchSlots,
  batches,
  courses,
  enrolments,
  notifications,
  roleAssignments,
  sessionOverrides,
  users,
} from "@/db/schema";
import { assertCan, reach, type Actor, type Target } from "../authz/engine";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { earliestStart, formatDate, normaliseTime } from "../lib/dates";
import { audit, withTenant } from "../tenant";
import { courseTarget } from "./courses";
import { hodsOf, notify } from "./notifications";
import { describeSlots, validateSlots, type ScheduledBatch, type Slot } from "./schedule";

const TEACHING_ROLES = ["hod", "permanent_faculty", "visiting_faculty"] as const;

function uni(actor: Actor) {
  return actor.universityId!;
}

export async function loadBatch(tx: Tx, universityId: string, batchId: string, opts: { lock?: boolean } = {}) {
  const q = tx.select().from(batches).where(eq(batches.id, batchId));
  const [batch] = opts.lock ? await q.for("update") : await q;
  if (!batch) throw new NotFoundError("Batch");
  const target: Target = { universityId, departmentIds: [batch.departmentId], batchIds: [batch.id] };
  return { batch, target };
}

/** Seats in use: paid students plus holds that haven't run out yet. */
export async function seatsTaken(tx: Tx, batchId: string, excludeEnrolmentId?: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(enrolments)
    .where(
      and(
        eq(enrolments.batchId, batchId),
        or(eq(enrolments.status, "active"), and(eq(enrolments.status, "held"), gt(enrolments.holdExpiresAt, sql`now()`))),
        excludeEnrolmentId ? sql`${enrolments.id} <> ${excludeEnrolmentId}` : undefined,
      ),
    );
  return n;
}

/** Batches with their timings, overrides and faculty — the input the timetable and clash check need. */
export async function scheduledBatches(tx: Tx, batchIds: string[]): Promise<(ScheduledBatch & { seatLimit: number; status: string; departmentId: string })[]> {
  if (batchIds.length === 0) return [];
  const rows = await tx
    .select({ batch: batches, courseTitle: courses.title })
    .from(batches)
    .innerJoin(courses, eq(courses.id, batches.courseId))
    .where(inArray(batches.id, batchIds));
  const slots = await tx.select().from(batchSlots).where(inArray(batchSlots.batchId, batchIds));
  const overrides = await tx.select().from(sessionOverrides).where(inArray(sessionOverrides.batchId, batchIds));
  const now = new Date();
  const faculty = await tx
    .select({ batchId: roleAssignments.batchId, name: users.name, endsAt: roleAssignments.endsAt })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(inArray(roleAssignments.batchId, batchIds), isNull(roleAssignments.revokedAt)));

  return rows.map(({ batch, courseTitle }) => ({
    batchId: batch.id,
    batchName: batch.name,
    courseId: batch.courseId,
    courseTitle,
    startDate: batch.startDate,
    endDate: batch.endDate,
    seatLimit: batch.seatLimit,
    status: batch.status,
    departmentId: batch.departmentId,
    joinUrl: batch.meetingUrl,
    slots: slots.filter((s) => s.batchId === batch.id).map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })),
    overrides: overrides
      .filter((o) => o.batchId === batch.id)
      .map((o) => ({ date: o.date, kind: o.kind, newDate: o.newDate, startTime: o.startTime, endTime: o.endTime, note: o.note })),
    faculty: faculty.filter((f) => f.batchId === batch.id && (!f.endsAt || f.endsAt > now)).map((f) => f.name),
  }));
}

/** Students currently in a batch (for notifications). */
async function studentsIn(tx: Tx, batchId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: enrolments.userId })
    .from(enrolments)
    .where(and(eq(enrolments.batchId, batchId), inArray(enrolments.status, ["active", "held"])));
  return rows.map((r) => r.userId);
}

export type FacultyInput = { userId: string; role: "permanent_faculty" | "visiting_faculty"; endsAt?: Date | null };

async function addFacultyTx(tx: Tx, actor: Actor, batch: typeof batches.$inferSelect, f: FacultyInput) {
  // Must already teach in this department (added under Users → Teaching).
  const now = new Date();
  const roles = await tx
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, f.userId),
        eq(roleAssignments.departmentId, batch.departmentId),
        inArray(roleAssignments.role, [...TEACHING_ROLES]),
        isNull(roleAssignments.revokedAt),
      ),
    );
  const membership = roles.find((r) => !r.endsAt || r.endsAt > now);
  if (!membership) throw new ValidationError("Add this person to the department's teaching staff first.");
  // Visiting faculty can't outlast their department access.
  let endsAt = f.endsAt ?? null;
  if (f.role === "visiting_faculty") {
    endsAt = endsAt ?? membership.endsAt;
    if (!endsAt) throw new ValidationError("Visiting faculty need an access end date.");
    if (membership.endsAt && endsAt > membership.endsAt) endsAt = membership.endsAt;
  }
  const [existing] = await tx
    .select()
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, f.userId), eq(roleAssignments.batchId, batch.id), isNull(roleAssignments.revokedAt)));
  if (existing) return existing;
  const [a] = await tx
    .insert(roleAssignments)
    .values({
      userId: f.userId,
      role: f.role,
      scopeType: "batch",
      universityId: batch.universityId,
      batchId: batch.id,
      endsAt,
      createdBy: actor.userId,
    })
    .returning();
  await audit(tx, actor, "batch.assign_faculty", "batch", batch.id, { userId: f.userId, role: f.role });
  return a;
}

export type BatchInput = {
  courseId: string;
  name: string;
  startDate: string;
  endDate: string;
  seatLimit: number;
  slots: Slot[];
  faculty: FacultyInput[];
  meetingUrl?: string | null;
};

function validateBatch(input: Pick<BatchInput, "name" | "startDate" | "endDate" | "seatLimit">) {
  if (input.name.trim().length < 2) throw new ValidationError("Give the batch a name, like Weekday morning.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))
    throw new ValidationError("Pick a start and end date.");
  if (input.endDate < input.startDate) throw new ValidationError("End date must be on or after the start date.");
  if (!Number.isInteger(input.seatLimit) || input.seatLimit < 1) throw new ValidationError("Seat limit must be at least 1.");
}

export async function createBatch(actor: Actor, input: BatchInput) {
  validateBatch(input);
  const slotError = validateSlots(input.slots);
  if (slotError) throw new ValidationError(slotError);
  if (input.faculty.length === 0) throw new ValidationError("Assign at least one faculty member.");

  return withTenant(actor, async (tx) => {
    const { course } = await courseTarget(tx, uni(actor), input.courseId);
    assertCan(actor, "batch.create", { universityId: uni(actor), departmentIds: [course.departmentId] });
    const [batch] = await tx
      .insert(batches)
      .values({
        universityId: uni(actor),
        courseId: course.id,
        departmentId: course.departmentId,
        name: input.name.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        seatLimit: input.seatLimit,
        meetingUrl: input.meetingUrl?.trim() || null,
        status: "open",
      })
      .returning();
    await tx.insert(batchSlots).values(
      input.slots.map((s) => ({
        universityId: uni(actor),
        batchId: batch.id,
        weekday: s.weekday,
        startTime: normaliseTime(s.startTime),
        endTime: normaliseTime(s.endTime),
      })),
    );
    for (const f of input.faculty) await addFacultyTx(tx, actor, batch, f);
    await audit(tx, actor, "batch.create", "batch", batch.id, {
      courseId: course.id,
      name: batch.name,
      seatLimit: batch.seatLimit,
      timings: describeSlots(input.slots),
    });
    return batch;
  });
}

export type BatchPatch = Partial<Pick<BatchInput, "name" | "startDate" | "endDate" | "seatLimit" | "slots" | "meetingUrl">> & {
  status?: "open" | "closed" | "archived";
};

/** Changing timings or dates notifies every student in the batch; their timetable updates by itself. */
export async function updateBatch(actor: Actor, batchId: string, patch: BatchPatch) {
  if (patch.slots) {
    const e = validateSlots(patch.slots);
    if (e) throw new ValidationError(e);
  }
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId, { lock: true });
    assertCan(actor, "batch.update", target);
    const next = {
      name: patch.name ?? batch.name,
      startDate: patch.startDate ?? batch.startDate,
      endDate: patch.endDate ?? batch.endDate,
      seatLimit: patch.seatLimit ?? batch.seatLimit,
    };
    validateBatch(next);
    if (patch.seatLimit !== undefined) {
      const taken = await seatsTaken(tx, batchId);
      if (patch.seatLimit < taken) throw new ConflictError(`${taken} seats are already taken. The limit can't go below that.`);
    }
    await tx
      .update(batches)
      .set({ ...next, ...(patch.meetingUrl !== undefined && { meetingUrl: patch.meetingUrl || null }), ...(patch.status && { status: patch.status }) })
      .where(eq(batches.id, batchId));

    const scheduleChanged = !!patch.slots || next.startDate !== batch.startDate || next.endDate !== batch.endDate;
    if (patch.slots) {
      await tx.delete(batchSlots).where(eq(batchSlots.batchId, batchId));
      await tx.insert(batchSlots).values(
        patch.slots.map((s) => ({
          universityId: uni(actor),
          batchId,
          weekday: s.weekday,
          startTime: normaliseTime(s.startTime),
          endTime: normaliseTime(s.endTime),
        })),
      );
    }
    if (scheduleChanged) {
      const [course] = await tx.select().from(courses).where(eq(courses.id, batch.courseId));
      await notify(tx, uni(actor), await studentsIn(tx, batchId), {
        kind: "timetable.changed",
        title: `${course.title}: ${next.name} timings changed`,
        body: patch.slots ? `New timings: ${describeSlots(patch.slots)}.` : `New dates: ${formatDate(next.startDate)} to ${formatDate(next.endDate)}.`,
        data: { batchId },
      });
    }
    await audit(tx, actor, "batch.update", "batch", batchId, patch as Record<string, unknown>);
  });
}

/** Cancel one class, move it, or add an extra one (holidays, make-up classes). */
export async function addSessionOverride(
  actor: Actor,
  batchId: string,
  input: { date: string; kind: "cancelled" | "rescheduled" | "extra"; newDate?: string; startTime?: string; endTime?: string; note?: string },
) {
  if (input.kind !== "cancelled" && (!input.startTime || !input.endTime)) throw new ValidationError("Pick the new time.");
  if (input.kind === "rescheduled" && !input.newDate) throw new ValidationError("Pick the new date.");
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "batch.update", target);
    const [o] = await tx
      .insert(sessionOverrides)
      .values({
        universityId: uni(actor),
        batchId,
        date: input.date,
        kind: input.kind,
        newDate: input.newDate ?? null,
        startTime: input.startTime ? normaliseTime(input.startTime) : null,
        endTime: input.endTime ? normaliseTime(input.endTime) : null,
        note: input.note ?? null,
        createdBy: actor.userId,
      })
      .returning();
    const [course] = await tx.select().from(courses).where(eq(courses.id, batch.courseId));
    const title =
      input.kind === "cancelled"
        ? `${course.title}: class on ${formatDate(input.date, { weekday: true })} is cancelled`
        : input.kind === "rescheduled"
          ? `${course.title}: class on ${formatDate(input.date, { weekday: true })} moved to ${formatDate(input.newDate!, { weekday: true })}`
          : `${course.title}: extra class on ${formatDate(input.date, { weekday: true })}`;
    await notify(tx, uni(actor), await studentsIn(tx, batchId), { kind: "timetable.changed", title, body: input.note ?? "", data: { batchId } });
    await audit(tx, actor, "batch.override", "batch", batchId, input as Record<string, unknown>);
    return o;
  });
}

export async function assignFaculty(actor: Actor, batchId: string, f: FacultyInput) {
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "batch.assign_faculty", target);
    return addFacultyTx(tx, actor, batch, f);
  });
}

/** A batch always keeps at least one faculty member. */
export async function removeFaculty(actor: Actor, batchId: string, userId: string) {
  return withTenant(actor, async (tx) => {
    const { target } = await loadBatch(tx, uni(actor), batchId, { lock: true });
    assertCan(actor, "batch.assign_faculty", target);
    const now = new Date();
    const current = (
      await tx.select().from(roleAssignments).where(and(eq(roleAssignments.batchId, batchId), isNull(roleAssignments.revokedAt)))
    ).filter((a) => !a.endsAt || a.endsAt > now);
    if (!current.some((a) => a.userId === userId)) throw new NotFoundError("Faculty on this batch");
    if (current.filter((a) => a.userId !== userId).length === 0)
      throw new ConflictError("A batch needs at least one faculty member. Add someone else first.");
    await tx
      .update(roleAssignments)
      .set({ revokedAt: now })
      .where(and(eq(roleAssignments.batchId, batchId), eq(roleAssignments.userId, userId), isNull(roleAssignments.revokedAt)));
    await audit(tx, actor, "batch.remove_faculty", "batch", batchId, { userId });
  });
}

/** Batches of one course for the admin panel: timings, seats left and faculty. */
export async function listBatches(actor: Actor, courseId: string) {
  return withTenant(actor, async (tx) => {
    const { target } = await courseTarget(tx, uni(actor), courseId);
    const r = reach(actor, "batch.view", uni(actor));
    const all = await tx.select({ id: batches.id }).from(batches).where(eq(batches.courseId, courseId)).orderBy(asc(batches.startDate));
    // Faculty only see their own batches; HOD and admin see all of them.
    const ids = all
      .map((b) => b.id)
      .filter((id) => r.all || target.departmentIds!.some((d) => r.departmentIds.has(d)) || r.batchIds.has(id));
    if (ids.length === 0) assertCan(actor, "batch.view", target);
    const sched = await scheduledBatches(tx, ids);
    const out = [];
    for (const b of sched) {
      const taken = await seatsTaken(tx, b.batchId);
      out.push({ ...b, timings: describeSlots(b.slots), seatsTaken: taken, seatsLeft: Math.max(0, b.seatLimit - taken) });
    }
    return out.sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || earliestStart(a.slots).localeCompare(earliestStart(b.slots)) || a.batchName.localeCompare(b.batchName),
    );
  });
}

/** Students in a batch (faculty "own students"). */
export async function batchRoster(actor: Actor, batchId: string) {
  return withTenant(actor, async (tx) => {
    const { target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "enrolment.view", target);
    return tx
      .select({ userId: users.id, name: users.name, email: users.email, status: enrolments.status, enrolledAt: enrolments.enrolledAt })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(and(eq(enrolments.batchId, batchId), inArray(enrolments.status, ["active", "held", "completed"])))
      .orderBy(users.name);
  });
}

/**
 * Daily job: warn HODs when a batch is about to lose all its faculty because visiting
 * faculty access is ending. Runs per university under row-level security.
 */
export async function facultyExpiryAlerts(actor: Actor, withinDays = 14) {
  return withTenant(actor, async (tx) => {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 86_400_000);
    const open = await tx.select().from(batches).where(inArray(batches.status, ["open", "closed"]));
    const alerts: { batchId: string; batchName: string; lastAccessEnds: Date }[] = [];
    for (const b of open) {
      const fac = (
        await tx.select().from(roleAssignments).where(and(eq(roleAssignments.batchId, b.id), isNull(roleAssignments.revokedAt)))
      ).filter((a) => !a.endsAt || a.endsAt > now);
      if (fac.length === 0 || fac.some((a) => !a.endsAt || a.endsAt > horizon)) continue;
      const last = new Date(Math.max(...fac.map((a) => a.endsAt!.getTime())));
      if (b.endDate < last.toISOString().slice(0, 10)) continue; // batch ends first — fine
      alerts.push({ batchId: b.id, batchName: b.name, lastAccessEnds: last });
      // Remind at most once a week per batch.
      const [recent] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.kind, "batch.faculty_expiring"),
            sql`${notifications.data}->>'batchId' = ${b.id}`,
            gt(notifications.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
          ),
        )
        .limit(1);
      if (recent) continue;
      const [course] = await tx.select().from(courses).where(eq(courses.id, b.courseId));
      await notify(tx, uni(actor), await hodsOf(tx, b.departmentId), {
        kind: "batch.faculty_expiring",
        title: `${course.title}: ${b.name} needs a new faculty member`,
        body: `Visiting faculty access ends on ${formatDate(last.toISOString().slice(0, 10))}, before the batch ends on ${formatDate(b.endDate)}.`,
        data: { batchId: b.id },
      });
    }
    return alerts;
  });
}

/** Everything the batch page needs. */
export async function getBatchDetail(actor: Actor, batchId: string) {
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "batch.view", target);
    const [course] = await tx.select().from(courses).where(eq(courses.id, batch.courseId));
    const [sched] = await scheduledBatches(tx, [batchId]);
    const now = new Date();
    const faculty = (
      await tx
        .select({ userId: users.id, name: users.name, role: roleAssignments.role, endsAt: roleAssignments.endsAt })
        .from(roleAssignments)
        .innerJoin(users, eq(users.id, roleAssignments.userId))
        .where(and(eq(roleAssignments.batchId, batchId), isNull(roleAssignments.revokedAt)))
        .orderBy(asc(users.name))
    ).filter((f) => !f.endsAt || f.endsAt > now);
    const taken = await seatsTaken(tx, batchId);
    return { batch, course, schedule: sched, faculty, seatsTaken: taken, target };
  });
}
