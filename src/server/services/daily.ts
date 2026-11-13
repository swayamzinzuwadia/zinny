/**
 * The jobs an institute does every day, each in as few steps as the rules allow:
 *
 *  - Put students straight into a batch (one, or many from the Students list or a CSV),
 *    the way accepting a request does: institute courses are free for their students,
 *    so the seat is active at once. Needs `user.admit` for the batch's department
 *    (admins everywhere, HODs in their department). Seats are checked; a student who
 *    already has a place in the course is left as they are.
 *  - "Add a student": the account, the batch and, if they paid at the desk, the fee
 *    receipt, in one transaction (addStudentQuickly).
 *  - "Send an announcement" to one or more batches (`batch.teach`: the batch's faculty,
 *    its HOD and admins).
 *  - The choices the dashboard's quick forms offer, already narrowed to what this person
 *    may do.
 *
 * Every write is audited; enrolments emit `enrolment.confirmed` like any other.
 */
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchSlots, batches, courses, departments, enrolments, roleAssignments, universities, users } from "@/db/schema";
import { assertCan, can, reach, type Actor } from "../authz/engine";
import { emit } from "../events";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { formatDate, todayIn } from "../lib/dates";
import { audit, withTenant } from "../tenant";
import { loadBatch, seatsTaken, studentsIn } from "./batches";
import { notify } from "./notifications";
import { admitStudentTx, ensureStudentRoleTx } from "./students";
import { inviteIfNoPassword, upsertPerson } from "./users";
import { recordFeeTx } from "@/modules/payments/fees";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Enrolment states that are over: anything else is a live place (or request) in the course. */
const FINISHED = ["completed", "cancelled", "expired", "ended"] as const;
export const MAX_BULK = 200;

function uni(actor: Actor) {
  return actor.universityId!;
}

async function today(tx: Tx, actor: Actor) {
  const [u] = await tx.select({ tz: universities.timezone }).from(universities).where(eq(universities.id, uni(actor)));
  return todayIn(u?.tz ?? "Asia/Kolkata");
}

/** Whether this person can put students into batches anywhere (admins) or in some departments (HODs). */
export function canPlaceStudents(actor: Actor) {
  const r = reach(actor, "user.admit", uni(actor));
  return r.all || r.departmentIds.size > 0;
}

/* ─────────────────────────── Students into a batch ─────────────────────────── */

export type PlacementResult = {
  batchName: string;
  courseTitle: string;
  /** Put in the batch now. */
  added: { userId: string; name: string }[];
  /** Already in this batch. */
  already: { userId: string; name: string }[];
  /** Have a place in another batch of the course: move them with a batch switch instead. */
  elsewhere: { userId: string; name: string }[];
};

/**
 * Puts students into a batch inside an open transaction. Checks `user.admit` on the batch's
 * department, that the batch is running and has the seats, and gives each student the
 * student role and the batch's department if they lacked them. A request already waiting
 * in this batch is accepted.
 */
export async function placeStudentsTx(tx: Tx, actor: Actor, batchId: string, userIds: string[]): Promise<PlacementResult> {
  if (!UUID.test(batchId)) throw new NotFoundError("Batch");
  const ids = [...new Set(userIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) throw new ValidationError("Pick at least one student.");
  if (ids.length > MAX_BULK) throw new ValidationError(`Add up to ${MAX_BULK} students at a time.`);
  const { batch, target } = await loadBatch(tx, uni(actor), batchId, { lock: true });
  assertCan(actor, "user.admit", target);
  const [course] = await tx.select({ id: courses.id, title: courses.title }).from(courses).where(eq(courses.id, batch.courseId));
  if (batch.recorded) throw new ValidationError("Recorded lessons are sold on the marketplace. Pick a batch with live classes.");
  if (batch.status === "archived") throw new ConflictError(`${batch.name} is archived. Pick a running batch.`, "batch_archived");
  if (batch.endDate < (await today(tx, actor))) throw new ConflictError(`${batch.name} ended on ${formatDate(batch.endDate)}. Pick a running batch.`, "batch_ended");

  const people = await tx
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.universityId, uni(actor)), isNull(roleAssignments.revokedAt)))
    .where(inArray(users.id, ids));
  if (people.length !== ids.length) throw new ValidationError("Someone in the list isn't part of this institute. Add them as a student first.");
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const live = await tx
    .select()
    .from(enrolments)
    .where(and(inArray(enrolments.userId, ids), eq(enrolments.courseId, batch.courseId), notInArray(enrolments.status, [...FINISHED])));
  const result: PlacementResult = { batchName: batch.name, courseTitle: course.title, added: [], already: [], elsewhere: [] };
  const toInsert: string[] = [];
  const toAccept: typeof live = [];
  for (const userId of ids) {
    const mine = live.find((e) => e.userId === userId);
    const who = { userId, name: nameOf.get(userId)! };
    if (!mine) toInsert.push(userId);
    else if (mine.batchId !== batch.id) result.elsewhere.push(who);
    else if (mine.status === "requested") toAccept.push(mine);
    else result.already.push(who);
  }
  const needed = toInsert.length + toAccept.length;
  if (needed === 0) return result;
  const left = batch.seatLimit - (await seatsTaken(tx, batch.id));
  if (needed > left) {
    throw new ConflictError(
      left <= 0
        ? `${batch.name} is full. Add seats to the batch first, or pick another batch.`
        : `${batch.name} has ${left} seat${left === 1 ? "" : "s"} left, and you picked ${needed} student${needed === 1 ? "" : "s"}. Add seats to the batch first, or pick fewer students.`,
      "batch_full",
    );
  }

  const now = new Date();
  const decided = { decidedAt: now, decidedBy: actor.userId || null };
  for (const userId of [...toInsert, ...toAccept.map((e) => e.userId)]) {
    await admitStudentTx(tx, actor, userId, [batch.departmentId]);
  }
  const placed: { enrolmentId: string; userId: string }[] = [];
  if (toInsert.length) {
    const rows = await tx
      .insert(enrolments)
      .values(toInsert.map((userId) => ({ universityId: uni(actor), userId, courseId: batch.courseId, batchId: batch.id, status: "active" as const, enrolledAt: now, ...decided })))
      .returning({ id: enrolments.id, userId: enrolments.userId });
    placed.push(...rows.map((r) => ({ enrolmentId: r.id, userId: r.userId })));
  }
  for (const e of toAccept) {
    await tx.update(enrolments).set({ status: "active", enrolledAt: now, ...decided }).where(eq(enrolments.id, e.id));
    placed.push({ enrolmentId: e.id, userId: e.userId });
  }
  const startsLater = batch.startDate > (await today(tx, actor));
  await notify(
    tx,
    uni(actor),
    placed.map((p) => p.userId),
    {
      kind: "enrolment.confirmed",
      title: `You're enrolled in ${course.title}`,
      body: startsLater ? `${batch.name} starts on ${formatDate(batch.startDate)}. It's on your timetable.` : `${batch.name} is on your timetable now.`,
      data: { courseId: course.id, batchId: batch.id },
    },
  );
  for (const p of placed) {
    await audit(tx, actor, "enrolment.add", "enrolment", p.enrolmentId, { userId: p.userId, batchId: batch.id });
    await emit(tx, actor, "enrolment.confirmed", { enrolmentId: p.enrolmentId, userId: p.userId, courseId: course.id, batchId: batch.id });
  }
  result.added = placed.map((p) => ({ userId: p.userId, name: nameOf.get(p.userId)! }));
  return result;
}

/** Puts one or many existing students into a batch (Students list, "Add to batch"). */
export async function addStudentsToBatch(actor: Actor, batchId: string, userIds: string[]): Promise<PlacementResult> {
  if (!canPlaceStudents(actor)) throw new ForbiddenError();
  return withTenant(actor, (tx) => placeStudentsTx(tx, actor, batchId, userIds));
}

/** A sentence saying what happened, for the page that asked. */
export function placementSummary(r: PlacementResult): string {
  const names = (l: { name: string }[]) => (l.length <= 3 ? l.map((x) => x.name).join(", ") : `${l.slice(0, 2).map((x) => x.name).join(", ")} and ${l.length - 2} more`);
  const parts = [
    r.added.length ? `${r.added.length === 1 ? r.added[0].name : `${r.added.length} students`} added to ${r.courseTitle}, ${r.batchName}. They've been told.` : "",
    r.already.length ? `${names(r.already)} ${r.already.length === 1 ? "was" : "were"} already in it.` : "",
    r.elsewhere.length ? `${names(r.elsewhere)} already ${r.elsewhere.length === 1 ? "has a place" : "have places"} in another batch of this course; move them with a batch switch.` : "",
  ].filter(Boolean);
  return parts.join(" ") || "Nothing to change.";
}

/* ─────────────────────────── Add a student ─────────────────────────── */

export type QuickStudentInput = {
  name: string;
  email: string;
  phone?: string | null;
  /** The batch to put them in. Without one, `departmentId` says which courses they see. */
  batchId?: string | null;
  departmentId?: string | null;
  /** They paid at the desk: record it (needs `finance.manage`). Amount left out = the course price. */
  fee?: { amountPaise?: number | null; mode: string; reference?: string | null } | null;
};

export type QuickStudentResult = { userId: string; placement: PlacementResult | null; invoiceNumber: string | null };

/**
 * The account, the batch place and the fee receipt in one transaction. If any part fails,
 * nothing is saved. A person who already has an account (by email) is reused.
 */
export async function addStudentQuickly(actor: Actor, input: QuickStudentInput): Promise<QuickStudentResult> {
  if (!canPlaceStudents(actor)) throw new ForbiddenError();
  const name = input.name.replace(/\s+/g, " ").trim();
  const email = input.email.trim().toLowerCase();
  const phone = (input.phone ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new ValidationError("Enter the student's full name.");
  if (!emailRe.test(email)) throw new ValidationError("Enter a valid email. The student signs in with it.");
  if (phone.length > 20) throw new ValidationError("Keep the phone number under 20 characters.");
  if (!input.batchId && !input.departmentId) throw new ValidationError("Pick a batch to put them in, or a department so they see its courses.");
  if (input.fee) {
    if (!can(actor, "finance.manage", { universityId: uni(actor) })) throw new ValidationError("Only Accounts & Fees and Institute Admins record fees. Untick \"Paid now\".");
    if (!input.batchId) throw new ValidationError("A fee paid now is for a course: pick the batch, or untick \"Paid now\".");
  }
  return withTenant(actor, async (tx) => {
    // Permission for the place first, before anything is written.
    if (input.batchId) {
      if (!UUID.test(input.batchId)) throw new NotFoundError("Batch");
      assertCan(actor, "user.admit", (await loadBatch(tx, uni(actor), input.batchId)).target);
    } else {
      assertCan(actor, "user.admit", { universityId: uni(actor), departmentIds: [input.departmentId!] });
    }
    const userId = await upsertPerson(tx, email, name, phone || null);
    const newStudent = await ensureStudentRoleTx(tx, actor, userId);
    let placement: PlacementResult | null = null;
    let courseId: string | null = null;
    if (input.batchId) {
      placement = await placeStudentsTx(tx, actor, input.batchId, [userId]);
      if (placement.elsewhere.length) {
        throw new ConflictError(`${name} already has a place in another batch of ${placement.courseTitle}. Move them with a batch switch instead.`, "elsewhere");
      }
      const [b] = await tx.select({ courseId: batches.courseId }).from(batches).where(eq(batches.id, input.batchId));
      courseId = b.courseId;
    } else {
      await admitStudentTx(tx, actor, userId, [input.departmentId!]);
    }
    await audit(tx, actor, "user.add", "user", userId, { email, role: "student", batchId: input.batchId ?? null });
    if (newStudent) await inviteIfNoPassword(tx, actor, userId, "student");
    let invoiceNumber: string | null = null;
    if (input.fee) {
      const fee = await recordFeeTx(tx, actor, { userId, courseId, amountPaise: input.fee.amountPaise ?? null, mode: input.fee.mode, reference: input.fee.reference });
      invoiceNumber = fee.number;
    }
    return { userId, placement, invoiceNumber };
  });
}

/* ─────────────────────────── Announcements ─────────────────────────── */

export type AnnouncementInput = { batchIds: string[]; title: string; body: string };

/**
 * Sends a message to every student in the batches (active, or paying for their seat now).
 * Needs `batch.teach` on each batch. A student in two of the batches gets it once.
 */
export async function sendAnnouncement(actor: Actor, input: AnnouncementInput): Promise<{ students: number; batches: number }> {
  const batchIds = [...new Set(input.batchIds)].filter((id) => UUID.test(id));
  const title = input.title.replace(/\s+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (batchIds.length === 0) throw new ValidationError("Pick the batch to send it to.");
  if (batchIds.length > 50) throw new ValidationError("Send to up to 50 batches at a time.");
  if (title.length < 3) throw new ValidationError("Write a short headline, like \"No class on Friday\".");
  if (title.length > 120) throw new ValidationError("Keep the headline under 120 characters.");
  if (body.length > 1000) throw new ValidationError("Keep the message under 1,000 characters.");
  return withTenant(actor, async (tx) => {
    const found = await tx.select({ id: batches.id, departmentId: batches.departmentId, name: batches.name }).from(batches).where(inArray(batches.id, batchIds));
    if (found.length !== batchIds.length) throw new NotFoundError("Batch");
    for (const b of found) assertCan(actor, "batch.teach", { universityId: uni(actor), departmentIds: [b.departmentId], batchIds: [b.id] });
    const students = new Set<string>();
    for (const b of found) for (const s of await studentsIn(tx, b.id)) students.add(s);
    if (students.size === 0) throw new ValidationError(found.length === 1 ? `${found[0].name} has no students yet, so there's nobody to tell.` : "These batches have no students yet, so there's nobody to tell.");
    await notify(tx, uni(actor), [...students], {
      kind: "batch.announcement",
      title,
      body: body ? `${body}\n\nFrom ${actor.name}` : `From ${actor.name}`,
      data: { batchIds, from: actor.userId },
    });
    for (const b of found) await audit(tx, actor, "batch.announce", "batch", b.id, { title, students: students.size });
    return { students: students.size, batches: found.length };
  });
}

/* ─────────────────────────── What the quick forms offer ─────────────────────────── */

export type BatchChoice = {
  id: string;
  courseId: string;
  departmentId: string;
  label: string;
  pricePaise: number;
  seatsLeft: number;
  /** The batch's usual class time, to start an extra class from. */
  startTime: string | null;
  endTime: string | null;
};

/**
 * Running batches (not ended, not archived, not recorded), each list narrowed to what the
 * person may do: put students in (`user.admit`), message (`batch.teach`), change the
 * timetable (`batch.update`).
 */
export async function quickChoices(actor: Actor): Promise<{ place: BatchChoice[]; announce: BatchChoice[]; schedule: BatchChoice[]; departments: { id: string; name: string }[] }> {
  const u = uni(actor);
  const scopes = { place: reach(actor, "user.admit", u), announce: reach(actor, "batch.teach", u), schedule: reach(actor, "batch.update", u) };
  const any = Object.values(scopes).some((r) => r.all || r.departmentIds.size > 0 || r.batchIds.size > 0);
  if (!any) return { place: [], announce: [], schedule: [], departments: [] };
  return withTenant(actor, async (tx) => {
    const day = await today(tx, actor);
    const rows = await tx
      .select({ b: batches, courseTitle: courses.title, pricePaise: courses.pricePaise })
      .from(batches)
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .where(and(eq(batches.recorded, false), notInArray(batches.status, ["archived"])))
      .orderBy(courses.title, batches.name);
    const running = rows.filter((r) => r.b.endDate >= day);
    const ids = running.map((r) => r.b.id);
    const slots = ids.length ? await tx.select().from(batchSlots).where(inArray(batchSlots.batchId, ids)) : [];
    const choices: BatchChoice[] = [];
    for (const r of running) {
      const first = slots.filter((s) => s.batchId === r.b.id).sort((a, z) => a.weekday - z.weekday)[0];
      choices.push({
        id: r.b.id,
        courseId: r.b.courseId,
        departmentId: r.b.departmentId,
        label: `${r.courseTitle}, ${r.b.name}`,
        pricePaise: r.pricePaise,
        seatsLeft: r.b.seatLimit - (await seatsTaken(tx, r.b.id)),
        startTime: first?.startTime.slice(0, 5) ?? null,
        endTime: first?.endTime.slice(0, 5) ?? null,
      });
    }
    const inScope = (s: ReturnType<typeof reach>) => (c: BatchChoice) => s.all || s.departmentIds.has(c.departmentId) || s.batchIds.has(c.id);
    const depts = scopes.place.all || scopes.place.departmentIds.size
      ? (await tx.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name)).filter(
          (d) => scopes.place.all || scopes.place.departmentIds.has(d.id),
        )
      : [];
    return {
      place: choices.filter(inScope(scopes.place)),
      announce: choices.filter(inScope(scopes.announce)),
      schedule: choices.filter(inScope(scopes.schedule)),
      departments: depts,
    };
  });
}
