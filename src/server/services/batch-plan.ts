/**
 * A batch's incharge, its sections (each with its own faculty) and the day-number plan.
 *
 * The plan says "Days 1-5 are Direct tax, with Farah". It never holds a date: the dated
 * timetable is worked out on every read from the batch's dates, weekly timings and one-off
 * changes (batchTimetable in schedule.ts), so it follows every change to the calendar.
 */
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchPlanDays, batchSections, batches, courses, enrolments, roleAssignments, universities, users } from "@/db/schema";
import { assertCan, type Actor, type Target } from "../authz/engine";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { normaliseTime, todayIn, toMinutes } from "../lib/dates";
import { audit, withTenant } from "../tenant";
import { addFacultyTx, loadBatch, scheduledBatches, studentsIn } from "./batches";
import { notify } from "./notifications";
import {
  annotateSessions,
  batchTimetable,
  formatDayRanges,
  MAX_PLAN_DAY,
  parseDayRanges,
  type BatchTimetable,
  type PlanDay,
  type PlanSection,
  type ScheduledBatch,
  type Session,
} from "./schedule";

const TEACHING_ROLES = ["hod", "permanent_faculty", "visiting_faculty"] as const;
const BATCH_FACULTY_ROLES = ["permanent_faculty", "visiting_faculty"] as const;

type Batch = typeof batches.$inferSelect;

function uni(actor: Actor) {
  return actor.universityId!;
}

async function tzOf(tx: Tx, universityId: string) {
  const [u] = await tx.select({ tz: universities.timezone }).from(universities).where(eq(universities.id, universityId));
  return u?.tz ?? "Asia/Kolkata";
}

const isLive = (a: { endsAt: Date | null }, now: Date) => !a.endsAt || a.endsAt > now;

/* ─────────────────────────── Reading the plan ─────────────────────────── */

export type SectionPlan = PlanSection & {
  description: string;
  days: { dayNumber: number; topic: string | null; startTime: string | null; endTime: string | null }[];
  /** The section's days as typed: "1-5, 8". */
  daysText: string;
};

/** Sections (in order, with faculty names and when their access ends) and plan days of some batches. */
async function loadPlansTx(tx: Tx, batchIds: string[], tz: string): Promise<Map<string, { sections: SectionPlan[]; days: PlanDay[] }>> {
  const out = new Map<string, { sections: SectionPlan[]; days: PlanDay[] }>(batchIds.map((id) => [id, { sections: [], days: [] }]));
  if (batchIds.length === 0) return out;
  const sections = await tx
    .select({ section: batchSections, facultyName: users.name })
    .from(batchSections)
    .leftJoin(users, eq(users.id, batchSections.facultyUserId))
    .where(inArray(batchSections.batchId, batchIds))
    .orderBy(asc(batchSections.position), asc(batchSections.createdAt));
  if (sections.length === 0) return out;
  const days = await tx.select().from(batchPlanDays).where(inArray(batchPlanDays.batchId, batchIds)).orderBy(asc(batchPlanDays.dayNumber));
  const access = await tx
    .select({ batchId: roleAssignments.batchId, userId: roleAssignments.userId, endsAt: roleAssignments.endsAt })
    .from(roleAssignments)
    .where(and(inArray(roleAssignments.batchId, batchIds), isNull(roleAssignments.revokedAt)));

  for (const { section: s, facultyName } of sections) {
    const mine = days.filter((d) => d.sectionId === s.id);
    const ends = access.find((a) => a.batchId === s.batchId && a.userId === s.facultyUserId)?.endsAt ?? null;
    const plan = out.get(s.batchId)!;
    plan.sections.push({
      id: s.id,
      title: s.title,
      description: s.description,
      position: s.position,
      facultyUserId: s.facultyUserId,
      facultyName: s.facultyUserId ? facultyName : null,
      // The last full day they can teach on, in the institute's time zone.
      facultyAccessEndsOn: ends ? todayIn(tz, new Date(ends.getTime() - 1)) : null,
      days: mine.map((d) => ({ dayNumber: d.dayNumber, topic: d.topic, startTime: d.startTime, endTime: d.endTime })),
      daysText: formatDayRanges(mine.map((d) => d.dayNumber)),
    });
    for (const d of mine) plan.days.push({ sectionId: s.id, dayNumber: d.dayNumber, topic: d.topic, startTime: d.startTime, endTime: d.endTime });
  }
  return out;
}

async function timetableTx(tx: Tx, batchId: string, tz: string) {
  const [sched] = await scheduledBatches(tx, [batchId]);
  const plan = (await loadPlansTx(tx, [batchId], tz)).get(batchId)!;
  return { sched, plan, timetable: batchTimetable(sched, plan.sections, plan.days) };
}

/**
 * Adds section, section faculty, topic and day number to sessions already expanded from
 * `sched` (the weekly timetables). Batches without a plan are left exactly as they were.
 */
export async function annotateWithPlansTx(tx: Tx, universityId: string, sched: ScheduledBatch[], sessions: Session[], viewerUserId?: string): Promise<Session[]> {
  const wanted = sched.filter((b) => sessions.some((s) => s.batchId === b.batchId));
  if (wanted.length === 0) return sessions;
  const plans = await loadPlansTx(tx, wanted.map((b) => b.batchId), await tzOf(tx, universityId));
  let out = sessions;
  for (const b of wanted) {
    const plan = plans.get(b.batchId)!;
    if (plan.sections.length === 0) continue;
    out = annotateSessions(out, b.batchId, batchTimetable(b, plan.sections, plan.days), viewerUserId);
  }
  return out;
}

async function inchargeOf(tx: Tx, batch: Batch) {
  if (!batch.inchargeUserId) return null;
  const [u] = await tx.select({ userId: users.id, name: users.name }).from(users).where(eq(users.id, batch.inchargeUserId));
  return u ?? null;
}

/** The first class date from today on (today counts, even once its class is over). */
function nextClassDate(t: BatchTimetable, today: string) {
  return t.days.find((d) => d.date >= today)?.date ?? null;
}

/** Everything the "Sections and plan" and "Timetable" tabs need. */
export async function getBatchPlan(actor: Actor, batchId: string) {
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "batch.view", target);
    const tz = await tzOf(tx, uni(actor));
    const today = todayIn(tz);
    const { sched, plan, timetable } = await timetableTx(tx, batchId, tz);
    return {
      batchId,
      schedule: sched,
      incharge: await inchargeOf(tx, batch),
      sections: plan.sections,
      timetable,
      today,
      nextClassDate: nextClassDate(timetable, today),
    };
  });
}

/** Only the dated timetable (the CSV download and other read-only uses). */
export async function readBatchTimetable(actor: Actor, batchId: string) {
  const p = await getBatchPlan(actor, batchId);
  return { timetable: p.timetable, today: p.today, nextClassDate: p.nextClassDate, schedule: p.schedule, incharge: p.incharge };
}

/** A student's own batch, start to finish: every class day with its section, faculty and topic. */
export async function myBatchTimetable(actor: Actor, enrolmentId: string) {
  assertCan(actor, "self.view_learning", { universityId: uni(actor), ownerUserId: actor.userId });
  return withTenant(actor, async (tx) => {
    const [e] = await tx
      .select()
      .from(enrolments)
      .where(and(eq(enrolments.id, enrolmentId), eq(enrolments.userId, actor.userId), inArray(enrolments.status, ["active", "completed"])));
    if (!e) throw new NotFoundError("Course");
    const { batch } = await loadBatch(tx, uni(actor), e.batchId);
    if (batch.recorded) throw new NotFoundError("Timetable");
    const tz = await tzOf(tx, uni(actor));
    const today = todayIn(tz);
    const { sched, timetable } = await timetableTx(tx, batch.id, tz);
    return {
      enrolmentId,
      courseTitle: sched.courseTitle,
      batchName: batch.name,
      batchFaculty: sched.faculty ?? [],
      incharge: (await inchargeOf(tx, batch))?.name ?? null,
      // Students see the timetable, never the planning problems.
      days: timetable.days,
      offDays: timetable.offDays,
      today,
      nextClassDate: nextClassDate(timetable, today),
    };
  });
}

/** Other batches of the same course that have a plan worth copying. */
export async function plansToCopy(actor: Actor, batchId: string) {
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "batch.update", target);
    const rows = await tx
      .select({
        batchId: batches.id,
        name: batches.name,
        startDate: batches.startDate,
        sections: sql<number>`count(distinct ${batchSections.id})::int`,
        days: sql<number>`count(distinct ${batchPlanDays.dayNumber})::int`,
      })
      .from(batches)
      .innerJoin(batchSections, eq(batchSections.batchId, batches.id))
      .leftJoin(batchPlanDays, eq(batchPlanDays.batchId, batches.id))
      .where(and(eq(batches.courseId, batch.courseId), ne(batches.id, batchId), eq(batches.recorded, false)))
      .groupBy(batches.id)
      .orderBy(asc(batches.startDate), asc(batches.name));
    return rows;
  });
}

/* ─────────────────────────── Incharge ─────────────────────────── */

/** Who may be a batch's incharge: the department's active teaching staff and the institute's admins. */
async function inchargeCandidatesTx(tx: Tx, batch: Batch) {
  const now = new Date();
  const rows = await tx
    .select({ id: users.id, name: users.name, role: roleAssignments.role, endsAt: roleAssignments.endsAt })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(
      and(
        isNull(roleAssignments.revokedAt),
        or(
          and(eq(roleAssignments.scopeType, "department"), eq(roleAssignments.departmentId, batch.departmentId), inArray(roleAssignments.role, [...TEACHING_ROLES])),
          and(eq(roleAssignments.scopeType, "university"), eq(roleAssignments.universityId, batch.universityId), eq(roleAssignments.role, "institute_admin")),
        ),
      ),
    )
    .orderBy(asc(users.name));
  const rank = ["hod", "permanent_faculty", "visiting_faculty", "institute_admin"];
  const best = new Map<string, { id: string; name: string; role: string }>();
  for (const r of rows.filter((x) => isLive(x, now))) {
    const had = best.get(r.id);
    if (!had || rank.indexOf(r.role) < rank.indexOf(had.role)) best.set(r.id, { id: r.id, name: r.name, role: r.role });
  }
  return [...best.values()];
}

export async function inchargeChoices(actor: Actor, batchId: string) {
  return withTenant(actor, async (tx) => {
    const { batch, target } = await loadBatch(tx, uni(actor), batchId);
    assertCan(actor, "batch.update", target);
    return inchargeCandidatesTx(tx, batch);
  });
}

/** Sets the batch's incharge, or clears it with `null`. */
export async function setIncharge(actor: Actor, batchId: string, userId: string | null) {
  return withTenant(actor, (tx) => setInchargeTx(tx, actor, batchId, userId));
}

/** setIncharge inside a transaction the caller already holds (the New course page sets the first batch's incharge). */
export async function setInchargeTx(tx: Tx, actor: Actor, batchId: string, userId: string | null) {
  const { batch, target } = await loadBatch(tx, uni(actor), batchId, { lock: true });
  assertCan(actor, "batch.update", target);
  if ((batch.inchargeUserId ?? null) === userId) return { changed: false };
  let name: string | null = null;
  if (userId) {
    const pick = (await inchargeCandidatesTx(tx, batch)).find((c) => c.id === userId);
    if (!pick) throw new ValidationError("The incharge must be on this department's teaching staff, or an institute admin.");
    name = pick.name;
  }
  await tx.update(batches).set({ inchargeUserId: userId }).where(eq(batches.id, batchId));
  if (userId && userId !== actor.userId) {
    const [course] = await tx.select({ title: courses.title }).from(courses).where(eq(courses.id, batch.courseId));
    await notify(tx, uni(actor), [userId], {
      kind: "batch.incharge",
      title: `You are the incharge of ${course.title}: ${batch.name}`,
      body: "Its sections, plan and timetable are on the batch page.",
      data: { batchId },
    });
  }
  await audit(tx, actor, "batch.incharge", "batch", batchId, { from: batch.inchargeUserId, to: userId });
  return { changed: true, name };
}

/* ─────────────────────────── Changing the plan ─────────────────────────── */

/** What students would notice: who teaches what, when, from today on. */
function upcoming(t: BatchTimetable, today: string) {
  return JSON.stringify(
    t.days
      .filter((d) => d.date >= today)
      .map((d) => [d.date, d.entries.map((e) => [toMinutes(e.startTime), toMinutes(e.endTime), e.sections.map((s) => [s.title, s.facultyName, s.topic])])]),
  );
}

/**
 * Runs one change to a batch's plan: permission, the change, then a single notification to
 * the batch's students if their upcoming days look different (never one per row).
 */
async function changePlan<T>(
  actor: Actor,
  where: { batchId: string } | { sectionId: string },
  fn: (tx: Tx, ctx: { batch: Batch; target: Target; section: typeof batchSections.$inferSelect | null }) => Promise<T>,
): Promise<T & { studentsNotified: number }> {
  return withTenant(actor, async (tx) => {
    let section: typeof batchSections.$inferSelect | null = null;
    if ("sectionId" in where) {
      [section] = await tx.select().from(batchSections).where(eq(batchSections.id, where.sectionId));
      if (!section) throw new NotFoundError("Section");
    }
    const batchId = section ? section.batchId : (where as { batchId: string }).batchId;
    const { batch, target } = await loadBatch(tx, uni(actor), batchId, { lock: true });
    assertCan(actor, "batch.update", target);
    if (batch.recorded) throw new ConflictError("Recorded lessons have no classes to plan.");
    const tz = await tzOf(tx, uni(actor));
    const today = todayIn(tz);
    const before = upcoming((await timetableTx(tx, batchId, tz)).timetable, today);
    const result = await fn(tx, { batch, target, section });
    const studentsNotified = await notifyIfChangedTx(tx, batch, before, tz);
    return { ...result, studentsNotified };
  });
}

async function notifyIfChangedTx(tx: Tx, batch: Batch, before: string, tz: string) {
  const after = upcoming((await timetableTx(tx, batch.id, tz)).timetable, todayIn(tz));
  if (after === before) return 0;
  const students = await studentsIn(tx, batch.id);
  if (students.length === 0) return 0;
  const [course] = await tx.select({ title: courses.title }).from(courses).where(eq(courses.id, batch.courseId));
  await notify(tx, batch.universityId, students, {
    kind: "timetable.changed",
    title: `${course.title}: ${batch.name} plan updated`,
    body: "Sections, faculty or topics changed for your upcoming classes. Your timetable shows the new plan.",
    data: { batchId: batch.id },
  });
  return students.length;
}

/**
 * When someone leaves a batch's faculty, their sections lose them. Called from removeFaculty
 * (the caller has checked permission and audits the removal). Returns the sections' titles.
 */
export async function clearFacultyFromSectionsTx(tx: Tx, batch: Batch, userId: string): Promise<{ sections: string[]; studentsNotified: number }> {
  const mine = await tx.select({ id: batchSections.id, title: batchSections.title }).from(batchSections).where(and(eq(batchSections.batchId, batch.id), eq(batchSections.facultyUserId, userId)));
  if (mine.length === 0) return { sections: [], studentsNotified: 0 };
  const tz = await tzOf(tx, batch.universityId);
  const before = upcoming((await timetableTx(tx, batch.id, tz)).timetable, todayIn(tz));
  await tx.update(batchSections).set({ facultyUserId: null }).where(inArray(batchSections.id, mine.map((s) => s.id)));
  return { sections: mine.map((s) => s.title), studentsNotified: await notifyIfChangedTx(tx, batch, before, tz) };
}

/**
 * A section's faculty must be an active faculty member of this batch. Picking someone from
 * the department's teaching staff who isn't on the batch yet puts them on it first, through
 * the same add-faculty rules as the batch page (and needs the same permission).
 */
async function resolveFacultyTx(tx: Tx, actor: Actor, batch: Batch, target: Target, userId: string): Promise<string> {
  const now = new Date();
  const onBatch = async () =>
    (
      await tx
        .select({ endsAt: roleAssignments.endsAt })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, userId),
            eq(roleAssignments.batchId, batch.id),
            inArray(roleAssignments.role, [...BATCH_FACULTY_ROLES]),
            isNull(roleAssignments.revokedAt),
          ),
        )
    ).some((a) => isLive(a, now));
  if (await onBatch()) return userId;

  assertCan(actor, "batch.assign_faculty", target);
  const membership = (
    await tx
      .select({ role: roleAssignments.role, endsAt: roleAssignments.endsAt })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.departmentId, batch.departmentId),
          inArray(roleAssignments.role, [...TEACHING_ROLES]),
          isNull(roleAssignments.revokedAt),
        ),
      )
  ).filter((a) => isLive(a, now));
  const permanent = membership.some((m) => m.role !== "visiting_faculty");
  // addFacultyTx refuses anyone who isn't on the department's teaching staff.
  await addFacultyTx(tx, actor, batch, { userId, role: permanent || membership.length === 0 ? "permanent_faculty" : "visiting_faculty" });
  if (!(await onBatch())) throw new ValidationError("This person's access to the batch has ended. Extend it under Users, or pick someone else.");
  return userId;
}

export type PlanDayInput = { dayNumber: number; topic?: string | null; startTime?: string | null; endTime?: string | null };

function cleanTitle(title: string) {
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length < 2) throw new ValidationError("Give the section a name, like Direct tax.");
  if (t.length > 80) throw new ValidationError("Keep the section name under 80 characters.");
  return t;
}

function cleanDescription(d: string | null | undefined) {
  const t = (d ?? "").trim();
  if (t.length > 500) throw new ValidationError("Keep the description under 500 characters.");
  return t;
}

function cleanDays(days: PlanDayInput[]) {
  const seen = new Set<number>();
  return days
    .map((d) => {
      if (!Number.isInteger(d.dayNumber) || d.dayNumber < 1) throw new ValidationError("Day numbers start at 1.");
      if (d.dayNumber > MAX_PLAN_DAY) throw new ValidationError(`Day ${d.dayNumber} is too far out. A plan can have up to ${MAX_PLAN_DAY} days.`);
      if (seen.has(d.dayNumber)) throw new ValidationError(`Day ${d.dayNumber} is listed twice for this section.`);
      seen.add(d.dayNumber);
      const topic = d.topic?.trim() || null;
      if (topic && topic.length > 200) throw new ValidationError(`Keep the topic for Day ${d.dayNumber} under 200 characters.`);
      const start = d.startTime?.trim() || null;
      const end = d.endTime?.trim() || null;
      if (!!start !== !!end) throw new ValidationError(`Give Day ${d.dayNumber} both a start and an end time, or leave both empty.`);
      if (start && end) {
        if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(start) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(end)) throw new ValidationError("Times must look like 09:00.");
        if (toMinutes(end) <= toMinutes(start)) throw new ValidationError(`On Day ${d.dayNumber} the end time must be after the start time.`);
      }
      return { dayNumber: d.dayNumber, topic, startTime: start ? normaliseTime(start) : null, endTime: end ? normaliseTime(end) : null };
    })
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

/**
 * Days typed as "1-5, 8, 10-12" into plan days. `details` carries the topic and times already
 * entered for a day, so retyping the ranges keeps them.
 */
export function planDaysFromText(text: string, details: Record<number, Omit<PlanDayInput, "dayNumber">> = {}): PlanDayInput[] {
  const parsed = parseDayRanges(text);
  if (parsed.error !== null) throw new ValidationError(parsed.error);
  return parsed.days.map((dayNumber) => ({ dayNumber, ...details[dayNumber] }));
}

async function assertTitleFree(tx: Tx, batchId: string, title: string, exceptId?: string) {
  const others = await tx.select({ id: batchSections.id, title: batchSections.title }).from(batchSections).where(eq(batchSections.batchId, batchId));
  if (others.some((o) => o.id !== exceptId && o.title.toLowerCase() === title.toLowerCase()))
    throw new ConflictError(`This batch already has a section called ${title}. Pick a different name.`);
}

async function replaceDaysTx(tx: Tx, section: { id: string; batchId: string; universityId: string }, days: PlanDayInput[]) {
  const clean = cleanDays(days);
  await tx.delete(batchPlanDays).where(eq(batchPlanDays.sectionId, section.id));
  if (clean.length > 0)
    await tx.insert(batchPlanDays).values(clean.map((d) => ({ universityId: section.universityId, batchId: section.batchId, sectionId: section.id, ...d })));
  return clean;
}

export type SectionInput = { title: string; description?: string | null; facultyUserId?: string | null; days?: PlanDayInput[] };

export async function createSection(actor: Actor, batchId: string, input: SectionInput) {
  const title = cleanTitle(input.title);
  const description = cleanDescription(input.description);
  return changePlan(actor, { batchId }, async (tx, { batch, target }) => {
    await assertTitleFree(tx, batchId, title);
    const facultyUserId = input.facultyUserId ? await resolveFacultyTx(tx, actor, batch, target, input.facultyUserId) : null;
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${batchSections.position}), -1)::int` }).from(batchSections).where(eq(batchSections.batchId, batchId));
    const [section] = await tx
      .insert(batchSections)
      .values({ universityId: batch.universityId, batchId, title, description, facultyUserId, position: last + 1 })
      .returning();
    const days = input.days ? await replaceDaysTx(tx, section, input.days) : [];
    await audit(tx, actor, "batch.section_create", "batch", batchId, { sectionId: section.id, title, facultyUserId, days: formatDayRanges(days.map((d) => d.dayNumber)) });
    return { section };
  });
}

export type SectionPatch = Partial<SectionInput>;

/** Edits a section: its name, description, faculty and days, in one save. Only the fields given change. */
export async function updateSection(actor: Actor, sectionId: string, patch: SectionPatch) {
  const title = patch.title === undefined ? undefined : cleanTitle(patch.title);
  const description = patch.description === undefined ? undefined : cleanDescription(patch.description);
  return changePlan(actor, { sectionId }, async (tx, { batch, target, section }) => {
    const s = section!;
    if (title !== undefined && title !== s.title) await assertTitleFree(tx, s.batchId, title, s.id);
    let facultyUserId: string | null | undefined;
    if (patch.facultyUserId !== undefined) {
      facultyUserId = patch.facultyUserId && patch.facultyUserId !== s.facultyUserId ? await resolveFacultyTx(tx, actor, batch, target, patch.facultyUserId) : patch.facultyUserId || null;
    }
    const set = {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(facultyUserId !== undefined && { facultyUserId }),
    };
    if (Object.keys(set).length > 0) await tx.update(batchSections).set(set).where(eq(batchSections.id, s.id));
    const days = patch.days ? await replaceDaysTx(tx, s, patch.days) : undefined;
    await audit(tx, actor, "batch.section_update", "batch", s.batchId, {
      sectionId: s.id,
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(facultyUserId !== undefined && { facultyUserId }),
      ...(days && { days: formatDayRanges(days.map((d) => d.dayNumber)) }),
    });
    return { sectionId: s.id, title: title ?? s.title };
  });
}

export const assignSectionFaculty = (actor: Actor, sectionId: string, facultyUserId: string | null) => updateSection(actor, sectionId, { facultyUserId });
export const setSectionDays = (actor: Actor, sectionId: string, days: PlanDayInput[]) => updateSection(actor, sectionId, { days });

export async function deleteSection(actor: Actor, sectionId: string) {
  return changePlan(actor, { sectionId }, async (tx, { section }) => {
    const s = section!;
    await tx.delete(batchSections).where(eq(batchSections.id, s.id));
    await audit(tx, actor, "batch.section_delete", "batch", s.batchId, { sectionId: s.id, title: s.title });
    return { title: s.title };
  });
}

/** Puts a batch's sections in the given order. Every section of the batch must be listed once. */
export async function reorderSections(actor: Actor, batchId: string, orderedIds: string[]) {
  return changePlan(actor, { batchId }, async (tx) => {
    const current = await tx.select({ id: batchSections.id }).from(batchSections).where(eq(batchSections.batchId, batchId));
    const ids = new Set(current.map((c) => c.id));
    if (orderedIds.length !== ids.size || new Set(orderedIds).size !== ids.size || orderedIds.some((id) => !ids.has(id)))
      throw new ValidationError("The order must list every section of this batch once. Reload the page and try again.");
    for (const [position, id] of orderedIds.entries()) await tx.update(batchSections).set({ position }).where(eq(batchSections.id, id));
    await audit(tx, actor, "batch.section_reorder", "batch", batchId, { order: orderedIds });
    return { order: orderedIds };
  });
}

/** Moves a section one place up or down. */
export async function moveSection(actor: Actor, sectionId: string, direction: "up" | "down") {
  return changePlan(actor, { sectionId }, async (tx, { section }) => {
    const s = section!;
    const all = await tx.select({ id: batchSections.id }).from(batchSections).where(eq(batchSections.batchId, s.batchId)).orderBy(asc(batchSections.position), asc(batchSections.createdAt));
    const ids = all.map((a) => a.id);
    const i = ids.indexOf(s.id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return { order: ids };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    for (const [position, id] of ids.entries()) await tx.update(batchSections).set({ position }).where(eq(batchSections.id, id));
    await audit(tx, actor, "batch.section_reorder", "batch", s.batchId, { order: ids });
    return { order: ids };
  });
}

/**
 * Replaces this batch's plan with a copy of another batch's of the same course: sections,
 * faculty and day numbers. Faculty who can't teach this batch are left out, and named.
 */
export async function copyPlan(actor: Actor, batchId: string, fromBatchId: string) {
  if (batchId === fromBatchId) throw new ValidationError("Pick a different batch to copy from.");
  return changePlan(actor, { batchId }, async (tx, { batch, target }) => {
    const { batch: from, target: fromTarget } = await loadBatch(tx, uni(actor), fromBatchId);
    assertCan(actor, "batch.view", fromTarget);
    if (from.courseId !== batch.courseId) throw new ValidationError("Pick another batch of this course.");
    const source = await tx.select().from(batchSections).where(eq(batchSections.batchId, fromBatchId)).orderBy(asc(batchSections.position), asc(batchSections.createdAt));
    if (source.length === 0) throw new ValidationError("That batch has no sections to copy.");
    const sourceDays = await tx.select().from(batchPlanDays).where(eq(batchPlanDays.batchId, fromBatchId));

    // Each person is settled once: on this batch already, added to it, or left out.
    const settled = new Map<string, string | null>();
    for (const userId of new Set(source.map((s) => s.facultyUserId).filter((u): u is string => !!u))) {
      try {
        settled.set(userId, await resolveFacultyTx(tx, actor, batch, target, userId));
      } catch (e) {
        if (!(e instanceof ValidationError) && !(e instanceof ForbiddenError)) throw e;
        settled.set(userId, null);
      }
    }

    await tx.delete(batchSections).where(eq(batchSections.batchId, batchId));
    const withoutFaculty: string[] = [];
    let days = 0;
    for (const [position, s] of source.entries()) {
      const facultyUserId = s.facultyUserId ? (settled.get(s.facultyUserId) ?? null) : null;
      if (s.facultyUserId && !facultyUserId) withoutFaculty.push(s.title);
      const [copy] = await tx
        .insert(batchSections)
        .values({ universityId: batch.universityId, batchId, title: s.title, description: s.description, facultyUserId, position })
        .returning();
      const mine = sourceDays.filter((d) => d.sectionId === s.id);
      days += mine.length;
      if (mine.length > 0)
        await tx.insert(batchPlanDays).values(
          mine.map((d) => ({ universityId: batch.universityId, batchId, sectionId: copy.id, dayNumber: d.dayNumber, topic: d.topic, startTime: d.startTime, endTime: d.endTime })),
        );
    }
    await audit(tx, actor, "batch.plan_copy", "batch", batchId, { fromBatchId, sections: source.length, days, withoutFaculty });
    return { fromBatchName: from.name, sections: source.length, days, withoutFaculty };
  });
}
