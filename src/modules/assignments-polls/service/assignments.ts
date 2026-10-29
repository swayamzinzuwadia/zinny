/**
 * Assignments (PRD page 7: the Assignments tab inside a course; page 8: learners submit).
 *
 * Staff: create, edit and delete assignments for a course (all batches) or some batches;
 * grade per batch. Faculty work in their own batches, HODs in their department, admins
 * everywhere (access.ts). Students hand in text and files until the due date, late if the
 * assignment allows it (with an automatic penalty), and keep every version.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { enrolments } from "@/db/schema";
import {
  assertCan,
  audit,
  batchStudentIds,
  can,
  emit,
  getCourseLite,
  notify,
  peopleLite,
  reach,
  universityLite,
  withTenant,
  type Actor,
} from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assignmentsForBatches,
  batchesWhere,
  canOnAll,
  courseBatchIds,
  coveredBatchIds,
  coveredBatchMap,
  learnerSeats,
  loadForStaff,
  names,
  ownTarget,
  seatFor,
  staffAccess,
  uni,
  canSeeAsStaff,
  type AssignmentRow,
  type LearnerSeat,
} from "../access";
import { MAX_TEXT_CHARS, MAX_UPLOAD_MB } from "../lib/files";
import { applyPenalty, parseMarks } from "../lib/grading";
import { MAX_INSTRUCTIONS_CHARS, plainText, sanitizeInstructions } from "../lib/sanitize";
import { dueLabel, zonedToInstant } from "../lib/time";
import { asgnAssignmentBatches, asgnAssignments, asgnFiles, asgnSubmissions, asgnSubmissionVersions } from "../schema";
import { claimFiles, deleteStored, filesFor, fileView, type FileView } from "./files";

export type SubmissionType = "text" | "files" | "both";
export const SUBMISSION_TYPES: SubmissionType[] = ["text", "files", "both"];
export const MAX_ATTACHMENTS = 10;
export const MAX_FEEDBACK_CHARS = 5_000;

export type AssignmentInput = {
  courseId: string;
  title: string;
  instructionsHtml: string;
  dueDate: string;
  dueTime: string;
  points: number;
  allowLate: boolean;
  latePenaltyPct: number;
  submissionType: SubmissionType;
  maxFiles: number;
  maxFileMb: number;
  /** "all": every batch of the course, now and later. */
  batchIds: string[] | "all";
  attachmentIds?: string[];
};

export type AssignmentPatch = Omit<AssignmentInput, "courseId" | "attachmentIds"> & {
  attachmentIds?: string[];
  removeAttachmentIds?: string[];
};

type Opts = { now?: Date };

/* ───────────────────────────── Validation ───────────────────────────── */

function int(n: unknown, what: string, min: number, max: number) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < min || v > max) throw new ValidationError(`${what} must be a whole number from ${min} to ${max}.`);
  return v;
}

function validate(input: Omit<AssignmentInput, "courseId" | "batchIds">, tz: string) {
  const title = (input.title ?? "").trim().replace(/\s+/g, " ");
  if (title.length < 3) throw new ValidationError("Give the assignment a title of at least 3 characters.");
  if (title.length > 200) throw new ValidationError("Keep the title under 200 characters.");
  if ((input.instructionsHtml ?? "").length > MAX_INSTRUCTIONS_CHARS * 2) throw new ValidationError("The instructions are too long. Attach longer material as a file.");
  const instructionsHtml = sanitizeInstructions(input.instructionsHtml ?? "");
  if (instructionsHtml.length > MAX_INSTRUCTIONS_CHARS) throw new ValidationError("The instructions are too long. Attach longer material as a file.");
  const dueAt = zonedToInstant(input.dueDate, input.dueTime, tz, "due");
  const points = int(input.points, "Points", 1, 1000);
  const allowLate = !!input.allowLate;
  const latePenaltyPct = allowLate ? int(input.latePenaltyPct ?? 0, "The late penalty", 0, 100) : 0;
  if (!SUBMISSION_TYPES.includes(input.submissionType)) throw new ValidationError("Pick how students hand in: a written answer, files, or both.");
  const usesFiles = input.submissionType !== "text";
  const maxFiles = usesFiles ? int(input.maxFiles, "The number of files", 1, 10) : 1;
  const maxFileMb = usesFiles ? int(input.maxFileMb, "The file size limit", 1, MAX_UPLOAD_MB) : 1;
  return { title, instructionsHtml, dueAt, points, allowLate, latePenaltyPct, submissionType: input.submissionType, maxFiles, maxFileMb };
}

/** Resolves the batch choice to batch ids of the course, checking the actor may manage each. */
function resolveBatches(actor: Actor, departmentId: string, courseBatches: string[], choice: string[] | "all") {
  if (choice === "all") {
    if (!canOnAll(actor, "assignment.manage", departmentId, courseBatches)) {
      throw new ForbiddenError("You can only set an assignment for every batch when you teach all of them. Pick your batches instead.");
    }
    return { allBatches: true, ids: courseBatches };
  }
  const ids = [...new Set(choice.filter(Boolean))];
  if (ids.length === 0) throw new ValidationError("Pick at least one batch.");
  if (ids.some((b) => !courseBatches.includes(b))) throw new NotFoundError("Batch");
  if (batchesWhere(actor, "assignment.manage", departmentId, ids).length !== ids.length) {
    throw new ForbiddenError("You can only set assignments for batches you teach.");
  }
  return { allBatches: false, ids };
}

/* ───────────────────────────── Notifications ───────────────────────────── */

/** Students who should see an assignment: active seats in the covered batches. */
async function studentsOf(tx: Tx, batchIds: string[]) {
  const lists = await Promise.all(batchIds.map((b) => batchStudentIds(tx, b)));
  return [...new Set(lists.flat())];
}

async function announceAssignment(tx: Tx, actor: Actor, a: AssignmentRow, batchIds: string[]) {
  const students = await studentsOf(tx, batchIds);
  if (students.length === 0) return;
  const u = await universityLite(tx);
  const course = await getCourseLite(tx, a.courseId);
  await notify(tx, uni(actor), students, {
    kind: "assignment.new",
    title: `New assignment: ${a.title}`,
    body: `${course.title}. ${dueLabel(a.dueAt, u.timezone)}.`,
    data: { assignmentId: a.id, href: `/${u.slug}/learn/assignments/${a.id}` },
  });
}

/* ───────────────────────────── Staff: create, edit, delete ───────────────────────────── */

export async function createAssignment(actor: Actor, input: AssignmentInput, opts: Opts = {}): Promise<AssignmentRow> {
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const course = await getCourseLite(tx, input.courseId);
    const tz = (await universityLite(tx)).timezone;
    const courseBatches = await courseBatchIds(tx, course.id);
    const { allBatches, ids } = resolveBatches(actor, course.departmentId, courseBatches, input.batchIds);
    const v = validate(input, tz);
    if (v.dueAt.getTime() <= now.getTime()) throw new ValidationError("Pick a due date and time in the future.");
    if ((input.attachmentIds ?? []).length > MAX_ATTACHMENTS) throw new ValidationError(`Attach at most ${MAX_ATTACHMENTS} files.`);
    const [a] = await tx
      .insert(asgnAssignments)
      .values({ universityId: uni(actor), courseId: course.id, departmentId: course.departmentId, ...v, allBatches, createdBy: actor.userId || null })
      .returning();
    if (!allBatches) await tx.insert(asgnAssignmentBatches).values(ids.map((batchId) => ({ universityId: uni(actor), assignmentId: a.id, batchId })));
    await claimFiles(tx, actor, input.attachmentIds ?? [], "attachment", { assignmentId: a.id });
    await audit(tx, actor, "assignment.create", "assignment", a.id, { courseId: course.id, title: a.title, batches: allBatches ? "all" : ids, dueAt: a.dueAt.toISOString() });
    await announceAssignment(tx, actor, a, ids);
    return a;
  });
}

export async function updateAssignment(actor: Actor, assignmentId: string, patch: AssignmentPatch): Promise<AssignmentRow> {
  const removedKeys: string[] = [];
  const out = await withTenant(actor, async (tx) => {
    const { a, access } = await loadForStaff(tx, actor, assignmentId, { lock: true });
    if (!access.manage) throw new ForbiddenError("Only staff who teach every batch of this assignment can change it.");
    const tz = (await universityLite(tx)).timezone;
    const courseBatches = await courseBatchIds(tx, a.courseId);
    const { allBatches, ids } = resolveBatches(actor, a.departmentId, courseBatches, patch.batchIds);
    const v = validate(patch, tz);

    const dropped = access.covered.filter((b) => !ids.includes(b));
    if (dropped.length) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(asgnSubmissions)
        .where(and(eq(asgnSubmissions.assignmentId, a.id), inArray(asgnSubmissions.batchId, dropped)));
      if (n > 0) throw new ConflictError("Students in a batch you removed have already handed in work or been graded. Keep that batch on the assignment.");
    }
    const [{ graded }] = await tx
      .select({ graded: sql<number>`count(*)::int` })
      .from(asgnSubmissions)
      .where(and(eq(asgnSubmissions.assignmentId, a.id), isNotNull(asgnSubmissions.gradedAt)));
    if (graded > 0 && v.points !== a.points) throw new ConflictError(`${graded} student${graded === 1 ? " is" : "s are"} already graded out of ${a.points}. Points can't change after grading.`);

    const existing = (await tx.select({ id: asgnFiles.id }).from(asgnFiles).where(and(eq(asgnFiles.assignmentId, a.id), eq(asgnFiles.purpose, "attachment"), isNotNull(asgnFiles.attachedAt)))).map((f) => f.id);
    const remove = (patch.removeAttachmentIds ?? []).filter((id) => existing.includes(id));
    if (existing.length - remove.length + (patch.attachmentIds ?? []).length > MAX_ATTACHMENTS) throw new ValidationError(`Attach at most ${MAX_ATTACHMENTS} files.`);

    const dueMoved = v.dueAt.getTime() !== a.dueAt.getTime();
    const [updated] = await tx
      .update(asgnAssignments)
      .set({ ...v, allBatches, updatedAt: new Date(), ...(dueMoved && { remindedAt: null }) })
      .where(eq(asgnAssignments.id, a.id))
      .returning();
    await tx.delete(asgnAssignmentBatches).where(eq(asgnAssignmentBatches.assignmentId, a.id));
    if (!allBatches) await tx.insert(asgnAssignmentBatches).values(ids.map((batchId) => ({ universityId: uni(actor), assignmentId: a.id, batchId })));

    if (dueMoved) {
      // Work not graded yet is late or on time against the new due date.
      const ungraded = await tx.select({ id: asgnSubmissions.id }).from(asgnSubmissions).where(and(eq(asgnSubmissions.assignmentId, a.id), isNull(asgnSubmissions.gradedAt)));
      const subIds = ungraded.map((s) => s.id);
      if (subIds.length) {
        await tx
          .update(asgnSubmissionVersions)
          .set({ late: sql`${asgnSubmissionVersions.submittedAt} > ${v.dueAt.toISOString()}::timestamptz` })
          .where(inArray(asgnSubmissionVersions.submissionId, subIds));
        await tx
          .update(asgnSubmissions)
          .set({ late: sql`coalesce(${asgnSubmissions.submittedAt} > ${v.dueAt.toISOString()}::timestamptz, false)` })
          .where(inArray(asgnSubmissions.id, subIds));
      }
    }

    if (remove.length) {
      const gone = await tx.delete(asgnFiles).where(and(inArray(asgnFiles.id, remove), eq(asgnFiles.assignmentId, a.id))).returning({ key: asgnFiles.storageKey });
      removedKeys.push(...gone.map((g) => g.key));
    }
    await claimFiles(tx, actor, patch.attachmentIds ?? [], "attachment", { assignmentId: a.id });

    await audit(tx, actor, "assignment.update", "assignment", a.id, {
      title: updated.title,
      batches: allBatches ? "all" : ids,
      dueAt: updated.dueAt.toISOString(),
      ...(dueMoved && { previousDueAt: a.dueAt.toISOString() }),
      removedAttachments: remove.length,
    });
    const added = ids.filter((b) => !access.covered.includes(b));
    if (added.length) await announceAssignment(tx, actor, updated, added);
    return updated;
  });
  await deleteStored(actor, removedKeys);
  return out;
}

export async function deleteAssignment(actor: Actor, assignmentId: string): Promise<void> {
  const keys = await withTenant(actor, async (tx) => {
    const { a, access } = await loadForStaff(tx, actor, assignmentId, { lock: true });
    if (!access.manage) throw new ForbiddenError("Only staff who teach every batch of this assignment can delete it.");
    const files = await tx.select({ key: asgnFiles.storageKey }).from(asgnFiles).where(eq(asgnFiles.assignmentId, a.id));
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(asgnSubmissions).where(eq(asgnSubmissions.assignmentId, a.id));
    await tx.delete(asgnAssignments).where(eq(asgnAssignments.id, a.id));
    await audit(tx, actor, "assignment.delete", "assignment", a.id, { title: a.title, courseId: a.courseId, submissions: n });
    return files.map((f) => f.key);
  });
  await deleteStored(actor, keys);
}

/* ───────────────────────────── Staff: reading ───────────────────────────── */

export type StaffAssignmentSummary = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  dueAt: Date;
  points: number;
  allowLate: boolean;
  latePenaltyPct: number;
  submissionType: SubmissionType;
  allBatches: boolean;
  batches: { id: string; name: string }[];
  /** Counts over the batches the viewer can see. */
  students: number;
  submitted: number;
  graded: number;
  toGrade: number;
  late: number;
  canManage: boolean;
  canGrade: boolean;
};

/** Students with a seat (active or completed) in each batch. */
async function rosterByBatch(tx: Tx, batchIds: string[]) {
  const map = new Map<string, string[]>();
  if (batchIds.length === 0) return map;
  const rows = await tx
    .select({ userId: enrolments.userId, batchId: enrolments.batchId })
    .from(enrolments)
    .where(and(inArray(enrolments.batchId, batchIds), inArray(enrolments.status, ["active", "completed"])));
  for (const r of rows) map.set(r.batchId, [...(map.get(r.batchId) ?? []), r.userId]);
  return map;
}

async function summarise(tx: Tx, actor: Actor, list: AssignmentRow[], onlyBatch?: string): Promise<StaffAssignmentSummary[]> {
  const covered = await coveredBatchMap(tx, list);
  const visible = list.filter((a) => canSeeAsStaff(actor, a, covered.get(a.id) ?? []));
  if (visible.length === 0) return [];
  const access = new Map(visible.map((a) => [a.id, staffAccess(actor, a, covered.get(a.id) ?? [])]));
  const allBatchIds = [...new Set(visible.flatMap((a) => covered.get(a.id) ?? []))];
  const roster = await rosterByBatch(tx, allBatchIds);
  const subs = await tx
    .select({
      assignmentId: asgnSubmissions.assignmentId,
      batchId: asgnSubmissions.batchId,
      submittedAt: asgnSubmissions.submittedAt,
      gradedAt: asgnSubmissions.gradedAt,
      late: asgnSubmissions.late,
    })
    .from(asgnSubmissions)
    .where(inArray(asgnSubmissions.assignmentId, visible.map((a) => a.id)));
  const n = await names(tx, visible.map((a) => a.courseId), allBatchIds);
  return visible.map((a) => {
    const acc = access.get(a.id)!;
    const seen = onlyBatch ? acc.viewBatchIds.filter((b) => b === onlyBatch) : acc.viewBatchIds;
    const mine = subs.filter((s) => s.assignmentId === a.id && seen.includes(s.batchId));
    return {
      id: a.id,
      title: a.title,
      courseId: a.courseId,
      courseTitle: n.course.get(a.courseId) ?? "",
      dueAt: a.dueAt,
      points: a.points,
      allowLate: a.allowLate,
      latePenaltyPct: a.latePenaltyPct,
      submissionType: a.submissionType,
      allBatches: a.allBatches,
      batches: (covered.get(a.id) ?? []).map((id) => ({ id, name: n.batch.get(id) ?? "" })),
      students: new Set(seen.flatMap((b) => roster.get(b) ?? [])).size,
      submitted: mine.filter((s) => s.submittedAt).length,
      graded: mine.filter((s) => s.gradedAt).length,
      toGrade: mine.filter((s) => s.submittedAt && !s.gradedAt).length,
      late: mine.filter((s) => s.late).length,
      canManage: acc.manage,
      canGrade: (onlyBatch ? acc.gradeBatchIds.filter((b) => b === onlyBatch) : acc.gradeBatchIds).length > 0,
    };
  });
}

const byDueDesc = (a: { dueAt: Date }, b: { dueAt: Date }) => b.dueAt.getTime() - a.dueAt.getTime();

/** Assignments of a course the actor can see (Assignments tab). */
export async function listCourseAssignments(actor: Actor, courseId: string): Promise<StaffAssignmentSummary[]> {
  return withTenant(actor, async (tx) => {
    await getCourseLite(tx, courseId);
    const list = await tx.select().from(asgnAssignments).where(eq(asgnAssignments.courseId, courseId));
    return (await summarise(tx, actor, list)).sort(byDueDesc);
  });
}

/** Assignments a batch has, with that batch's counts (admin batch page). */
export async function listBatchAssignments(actor: Actor, batchId: string): Promise<StaffAssignmentSummary[]> {
  return withTenant(actor, async (tx) => {
    const { batchLite } = await import("@/server/core");
    const b = await batchLite(tx, batchId);
    assertCan(actor, "assignment.view", b.target);
    const list = await assignmentsForBatches(tx, [{ courseId: b.courseId, batchId: b.id }]);
    return (await summarise(tx, actor, list, b.id)).sort(byDueDesc);
  });
}

/** Every assignment the actor can see, newest due date first (the Assignments page). */
export async function listStaffAssignments(actor: Actor): Promise<StaffAssignmentSummary[]> {
  const r = reach(actor, "assignment.view", uni(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    let list: AssignmentRow[];
    if (r.all) list = await tx.select().from(asgnAssignments);
    else {
      const byDept = r.departmentIds.size ? await tx.select().from(asgnAssignments).where(inArray(asgnAssignments.departmentId, [...r.departmentIds])) : [];
      const { batches } = await import("@/db/schema");
      const seats = r.batchIds.size
        ? (await tx.select({ batchId: batches.id, courseId: batches.courseId }).from(batches).where(inArray(batches.id, [...r.batchIds])))
        : [];
      const byBatch = await assignmentsForBatches(tx, seats);
      const m = new Map<string, AssignmentRow>();
      for (const a of [...byDept, ...byBatch]) m.set(a.id, a);
      list = [...m.values()];
    }
    return (await summarise(tx, actor, list)).sort(byDueDesc);
  });
}

export type StaffAssignmentDetail = {
  assignment: AssignmentRow;
  courseTitle: string;
  attachments: FileView[];
  batches: { id: string; name: string; canView: boolean; canGrade: boolean }[];
  canManage: boolean;
  gradedCount: number;
  timezone: string;
};

export async function getStaffAssignment(actor: Actor, assignmentId: string): Promise<StaffAssignmentDetail> {
  return withTenant(actor, async (tx) => {
    const { a, access } = await loadForStaff(tx, actor, assignmentId);
    const n = await names(tx, [a.courseId], access.covered);
    const attachments = (await filesFor(tx, { assignmentIds: [a.id] })).map(fileView);
    const [{ graded }] = await tx
      .select({ graded: sql<number>`count(*)::int` })
      .from(asgnSubmissions)
      .where(and(eq(asgnSubmissions.assignmentId, a.id), isNotNull(asgnSubmissions.gradedAt)));
    return {
      assignment: { ...a, instructionsHtml: sanitizeInstructions(a.instructionsHtml) },
      courseTitle: n.course.get(a.courseId) ?? "",
      attachments,
      batches: access.covered.map((id) => ({ id, name: n.batch.get(id) ?? "", canView: access.viewBatchIds.includes(id), canGrade: access.gradeBatchIds.includes(id) })),
      canManage: access.manage,
      gradedCount: graded,
      timezone: (await universityLite(tx)).timezone,
    };
  });
}

/** What the actor can do on a course's Assignments tab: which batches they may set work for. */
export async function assignmentFormOptions(actor: Actor, courseId: string) {
  return withTenant(actor, async (tx) => {
    const course = await getCourseLite(tx, courseId);
    const { listCourseBatches } = await import("@/server/core");
    const bs = await listCourseBatches(tx, courseId);
    const manageable = bs.filter((b) => can(actor, "assignment.manage", b.target));
    return {
      course,
      batches: manageable.map((b) => ({ id: b.id, name: b.name, status: b.status, endDate: b.endDate })),
      canAll: canOnAll(actor, "assignment.manage", course.departmentId, bs.map((b) => b.id)),
      canCreate: manageable.length > 0 || (bs.length === 0 && canOnAll(actor, "assignment.manage", course.departmentId, [])),
      timezone: (await universityLite(tx)).timezone,
    };
  });
}

/* ───────────────────────────── Grading ───────────────────────────── */

export type VersionView = { id: string; version: number; textAnswer: string; submittedAt: Date; late: boolean; files: FileView[] };

export type QueueRow = {
  student: { id: string; name: string; email: string };
  submissionId: string | null;
  status: "to_grade" | "missing" | "graded";
  submittedAt: Date | null;
  late: boolean;
  versions: VersionView[];
  marks: number | null;
  penaltyPct: number | null;
  finalMarks: number | null;
  scorePercent: number | null;
  feedback: string | null;
  gradedAt: Date | null;
  returned: FileView[];
  /** No longer has an active seat in this batch (switched, completed or left). */
  left: boolean;
};

export type GradingQueue = {
  assignment: AssignmentRow;
  batch: { id: string; name: string };
  canGrade: boolean;
  rows: QueueRow[];
  counts: { students: number; toGrade: number; graded: number; missing: number; late: number };
};

async function versionsOf(tx: Tx, submissionIds: string[]) {
  if (submissionIds.length === 0) return { versions: [], files: [] as (typeof asgnFiles.$inferSelect)[] };
  const versions = await tx
    .select()
    .from(asgnSubmissionVersions)
    .where(inArray(asgnSubmissionVersions.submissionId, submissionIds))
    .orderBy(desc(asgnSubmissionVersions.version));
  const files = await filesFor(tx, { submissionIds });
  return { versions, files };
}

function toVersionViews(submissionId: string, data: Awaited<ReturnType<typeof versionsOf>>): VersionView[] {
  return data.versions
    .filter((v) => v.submissionId === submissionId)
    .map((v) => ({
      id: v.id,
      version: v.version,
      textAnswer: v.textAnswer,
      submittedAt: v.submittedAt,
      late: v.late,
      files: data.files.filter((f) => f.versionId === v.id && f.purpose === "submission").map(fileView),
    }));
}

/** One batch's students for an assignment: work to grade first (oldest first), then missing, then graded. */
export async function gradingQueue(actor: Actor, assignmentId: string, batchId: string): Promise<GradingQueue> {
  return withTenant(actor, async (tx) => {
    const { a, access } = await loadForStaff(tx, actor, assignmentId);
    if (!access.viewBatchIds.includes(batchId)) throw new NotFoundError("Batch");
    const n = await names(tx, [], [batchId]);
    const active = await tx
      .select({ userId: enrolments.userId, status: enrolments.status })
      .from(enrolments)
      .where(and(eq(enrolments.batchId, batchId), inArray(enrolments.status, ["active", "completed"])));
    const subs = await tx.select().from(asgnSubmissions).where(and(eq(asgnSubmissions.assignmentId, a.id), eq(asgnSubmissions.batchId, batchId)));
    const ids = [...new Set([...active.map((e) => e.userId), ...subs.map((s) => s.userId)])];
    const people = await peopleLite(tx, ids);
    const data = await versionsOf(tx, subs.map((s) => s.id));
    const activeIds = new Set(active.filter((e) => e.status === "active").map((e) => e.userId));
    const rows: QueueRow[] = people.map((p) => {
      const s = subs.find((x) => x.userId === p.id);
      return {
        student: p,
        submissionId: s?.id ?? null,
        status: s?.gradedAt ? "graded" : s?.submittedAt ? "to_grade" : "missing",
        submittedAt: s?.submittedAt ?? null,
        late: s?.late ?? false,
        versions: s ? toVersionViews(s.id, data) : [],
        marks: s?.marks ?? null,
        penaltyPct: s?.penaltyPct ?? null,
        finalMarks: s?.finalMarks ?? null,
        scorePercent: s?.scorePercent ?? null,
        feedback: s?.feedback ?? null,
        gradedAt: s?.gradedAt ?? null,
        returned: s ? data.files.filter((f) => f.submissionId === s.id && f.purpose === "returned").map(fileView) : [],
        left: !activeIds.has(p.id) && !active.some((e) => e.userId === p.id),
      };
    });
    const rank = { to_grade: 0, missing: 1, graded: 2 } as const;
    rows.sort(
      (x, y) =>
        rank[x.status] - rank[y.status] ||
        (x.submittedAt?.getTime() ?? 0) - (y.submittedAt?.getTime() ?? 0) ||
        x.student.name.localeCompare(y.student.name),
    );
    return {
      assignment: { ...a, instructionsHtml: sanitizeInstructions(a.instructionsHtml) },
      batch: { id: batchId, name: n.batch.get(batchId) ?? "" },
      canGrade: access.gradeBatchIds.includes(batchId),
      rows,
      counts: {
        students: rows.length,
        toGrade: rows.filter((r) => r.status === "to_grade").length,
        graded: rows.filter((r) => r.status === "graded").length,
        missing: rows.filter((r) => r.status === "missing").length,
        late: rows.filter((r) => r.late).length,
      },
    };
  });
}

export type GradeInput = {
  assignmentId: string;
  studentId: string;
  marks: string | number;
  feedback?: string;
  returnedFileIds?: string[];
  removeReturnedIds?: string[];
};

/**
 * Grades one student's work. Work handed in late loses the assignment's late penalty
 * automatically. Students who handed in nothing can be graded too (paper work, or a zero).
 * Emits `assignment.graded` when the grade is new or changes, and tells the student.
 */
export async function gradeSubmission(actor: Actor, input: GradeInput, opts: Opts = {}) {
  const now = opts.now ?? new Date();
  const removedKeys: string[] = [];
  const result = await withTenant(actor, async (tx) => {
    const { a, access } = await loadForStaff(tx, actor, input.assignmentId);
    let [s] = await tx
      .select()
      .from(asgnSubmissions)
      .where(and(eq(asgnSubmissions.assignmentId, a.id), eq(asgnSubmissions.userId, input.studentId)))
      .for("update");
    let batchId: string | undefined = s?.batchId;
    if (!batchId) {
      const seats = await learnerSeats(tx, input.studentId);
      batchId = seatFor(seats, a, access.covered)?.batchId;
    }
    if (!batchId) throw new NotFoundError("Student");
    if (!access.gradeBatchIds.includes(batchId)) throw new ForbiddenError("You can only grade students in batches you teach.");

    const marks = parseMarks(input.marks, a.points);
    const feedback = (input.feedback ?? "").trim();
    if (feedback.length > MAX_FEEDBACK_CHARS) throw new ValidationError(`Keep feedback under ${MAX_FEEDBACK_CHARS} characters, or return a file instead.`);
    const late = s?.late ?? false;
    const g = applyPenalty(marks, a.points, late, a.latePenaltyPct);
    const before = s ? { finalMarks: s.finalMarks, gradedAt: s.gradedAt, feedback: s.feedback } : null;

    if (!s) {
      [s] = await tx
        .insert(asgnSubmissions)
        .values({ universityId: uni(actor), assignmentId: a.id, userId: input.studentId, batchId })
        .onConflictDoNothing()
        .returning();
      if (!s) throw new ConflictError("Someone else just changed this student's work. Reload and try again.");
    }
    const [graded] = await tx
      .update(asgnSubmissions)
      .set({ marks, penaltyPct: g.penaltyPct, finalMarks: g.finalMarks, scorePercent: g.scorePercent, feedback: feedback || null, gradedBy: actor.userId || null, gradedAt: now })
      .where(eq(asgnSubmissions.id, s.id))
      .returning();

    const remove = input.removeReturnedIds ?? [];
    if (remove.length) {
      const gone = await tx
        .delete(asgnFiles)
        .where(and(inArray(asgnFiles.id, remove), eq(asgnFiles.submissionId, s.id), eq(asgnFiles.purpose, "returned")))
        .returning({ key: asgnFiles.storageKey });
      removedKeys.push(...gone.map((x) => x.key));
    }
    const returned = await claimFiles(tx, actor, input.returnedFileIds ?? [], "returned", { assignmentId: a.id, submissionId: s.id });

    const changed = !before?.gradedAt || before.finalMarks !== g.finalMarks;
    await audit(tx, actor, before?.gradedAt ? "assignment.regrade" : "assignment.grade", "asgn_submission", s.id, {
      assignmentId: a.id,
      studentId: input.studentId,
      marks,
      penaltyPct: g.penaltyPct,
      finalMarks: g.finalMarks,
      ...(before?.gradedAt && { previousFinalMarks: before.finalMarks }),
      returnedFiles: returned.length,
    });
    if (changed) {
      await emit(tx, actor, "assignment.graded", { submissionId: s.id, assignmentId: a.id, userId: input.studentId, batchId, scorePercent: g.scorePercent });
    }
    if (changed || returned.length || (feedback || null) !== (before?.feedback ?? null)) {
      const u = await universityLite(tx);
      await notify(tx, uni(actor), [input.studentId], {
        kind: "assignment.graded",
        title: before?.gradedAt ? `Your grade for ${a.title} was updated` : `${a.title} has been graded`,
        body: `You got ${g.finalMarks} out of ${a.points}${g.penaltyPct ? `, after a ${g.penaltyPct}% late penalty` : ""}.`,
        data: { assignmentId: a.id, href: `/${u.slug}/learn/assignments/${a.id}` },
      });
    }
    return graded;
  });
  await deleteStored(actor, removedKeys);
  return result;
}

/* ───────────────────────────── Students ───────────────────────────── */

export type LearnerStatus = "due" | "overdue" | "missed" | "submitted" | "graded";

export type LearnerAssignment = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  batchId: string;
  enrolmentId: string;
  dueAt: Date;
  points: number;
  allowLate: boolean;
  latePenaltyPct: number;
  submissionType: SubmissionType;
  status: LearnerStatus;
  canSubmit: boolean;
  submittedAt: Date | null;
  versionCount: number;
  late: boolean;
  finalMarks: number | null;
  scorePercent: number | null;
  gradedAt: Date | null;
  preview: string;
};

function learnerStatus(a: AssignmentRow, seat: LearnerSeat, s: typeof asgnSubmissions.$inferSelect | undefined, now: Date): { status: LearnerStatus; canSubmit: boolean } {
  const open = seat.status === "active";
  const pastDue = now.getTime() > a.dueAt.getTime();
  if (s?.gradedAt) return { status: "graded", canSubmit: false };
  if (s?.submittedAt) return { status: "submitted", canSubmit: open && !pastDue };
  if (!pastDue) return { status: "due", canSubmit: open };
  if (a.allowLate && open) return { status: "overdue", canSubmit: true };
  return { status: "missed", canSubmit: false };
}

/** The student's assignments, across their courses or for one course. */
export async function myAssignments(actor: Actor, opts: Opts & { courseId?: string } = {}): Promise<LearnerAssignment[]> {
  assertCan(actor, "self.submit_assignment", ownTarget(actor));
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const seats = (await learnerSeats(tx, actor.userId)).filter((s) => !opts.courseId || s.courseId === opts.courseId);
    const list = await assignmentsForBatches(tx, seats);
    const covered = await coveredBatchMap(tx, list);
    const subs = list.length
      ? await tx.select().from(asgnSubmissions).where(and(eq(asgnSubmissions.userId, actor.userId), inArray(asgnSubmissions.assignmentId, list.map((a) => a.id))))
      : [];
    const n = await names(tx, list.map((a) => a.courseId), []);
    const out: LearnerAssignment[] = [];
    for (const a of list) {
      const seat = seatFor(seats, a, covered.get(a.id) ?? []);
      if (!seat) continue;
      const s = subs.find((x) => x.assignmentId === a.id);
      const st = learnerStatus(a, seat, s, now);
      out.push({
        id: a.id,
        title: a.title,
        courseId: a.courseId,
        courseTitle: n.course.get(a.courseId) ?? "",
        batchId: seat.batchId,
        enrolmentId: seat.enrolmentId,
        dueAt: a.dueAt,
        points: a.points,
        allowLate: a.allowLate,
        latePenaltyPct: a.latePenaltyPct,
        submissionType: a.submissionType,
        ...st,
        submittedAt: s?.submittedAt ?? null,
        versionCount: s?.versionCount ?? 0,
        late: s?.late ?? false,
        finalMarks: s?.gradedAt ? s.finalMarks : null,
        scorePercent: s?.gradedAt ? s.scorePercent : null,
        gradedAt: s?.gradedAt ?? null,
        preview: plainText(a.instructionsHtml).slice(0, 160),
      });
    }
    return out.sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime());
  });
}

export type LearnerAssignmentDetail = LearnerAssignment & {
  instructionsHtml: string;
  attachments: FileView[];
  maxFiles: number;
  maxFileMb: number;
  versions: VersionView[];
  feedback: string | null;
  marks: number | null;
  penaltyPct: number | null;
  returned: FileView[];
  /** Why the student can't hand in now, when they can't. */
  closedReason: string | null;
  timezone: string;
};

export async function myAssignment(actor: Actor, assignmentId: string, opts: Opts = {}): Promise<LearnerAssignmentDetail> {
  assertCan(actor, "self.submit_assignment", ownTarget(actor));
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const [a] = await tx.select().from(asgnAssignments).where(eq(asgnAssignments.id, assignmentId));
    if (!a) throw new NotFoundError("Assignment");
    const seats = await learnerSeats(tx, actor.userId);
    const seat = seatFor(seats, a, await coveredBatchIds(tx, a));
    if (!seat) throw new NotFoundError("Assignment");
    const [s] = await tx.select().from(asgnSubmissions).where(and(eq(asgnSubmissions.assignmentId, a.id), eq(asgnSubmissions.userId, actor.userId)));
    const st = learnerStatus(a, seat, s, now);
    const data = s ? await versionsOf(tx, [s.id]) : { versions: [], files: [] };
    const n = await names(tx, [a.courseId], []);
    const closedReason = st.canSubmit
      ? null
      : seat.status !== "active"
        ? "This course has ended, so work can't be handed in any more."
        : s?.gradedAt
          ? "Your work has been graded, so it can't be changed."
          : s?.submittedAt
            ? "The due date has passed, so your work can't be changed."
            : "The due date has passed and this assignment doesn't take late work.";
    return {
      id: a.id,
      title: a.title,
      courseId: a.courseId,
      courseTitle: n.course.get(a.courseId) ?? "",
      batchId: seat.batchId,
      enrolmentId: seat.enrolmentId,
      dueAt: a.dueAt,
      points: a.points,
      allowLate: a.allowLate,
      latePenaltyPct: a.latePenaltyPct,
      submissionType: a.submissionType,
      ...st,
      submittedAt: s?.submittedAt ?? null,
      versionCount: s?.versionCount ?? 0,
      late: s?.late ?? false,
      finalMarks: s?.gradedAt ? s.finalMarks : null,
      scorePercent: s?.gradedAt ? s.scorePercent : null,
      gradedAt: s?.gradedAt ?? null,
      preview: plainText(a.instructionsHtml).slice(0, 160),
      instructionsHtml: sanitizeInstructions(a.instructionsHtml),
      attachments: (await filesFor(tx, { assignmentIds: [a.id] })).map(fileView),
      maxFiles: a.maxFiles,
      maxFileMb: a.maxFileMb,
      versions: s ? toVersionViews(s.id, data) : [],
      feedback: s?.gradedAt ? s.feedback : null,
      marks: s?.gradedAt ? s.marks : null,
      penaltyPct: s?.gradedAt ? s.penaltyPct : null,
      returned: s?.gradedAt ? data.files.filter((f) => f.purpose === "returned").map(fileView) : [],
      closedReason,
      timezone: (await universityLite(tx)).timezone,
    };
  });
}

export type SubmitInput = {
  assignmentId: string;
  text?: string;
  /** Newly uploaded files (staged). */
  fileIds?: string[];
  /** Files from the latest version to keep in this one. */
  keepFileIds?: string[];
};

/**
 * Hands in work. Before the due date students can hand in again as often as they like
 * (every version is kept). After it, work is refused unless the assignment takes late
 * work and nothing was handed in yet; late work is marked and loses the penalty when graded.
 */
export async function submitAssignment(actor: Actor, input: SubmitInput, opts: Opts = {}) {
  assertCan(actor, "self.submit_assignment", ownTarget(actor));
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const [a] = await tx.select().from(asgnAssignments).where(eq(asgnAssignments.id, input.assignmentId));
    if (!a) throw new NotFoundError("Assignment");
    const seat = seatFor(await learnerSeats(tx, actor.userId), a, await coveredBatchIds(tx, a));
    if (!seat) throw new NotFoundError("Assignment");
    if (seat.status !== "active") throw new ValidationError("This course has ended, so work can't be handed in any more.");

    await tx
      .insert(asgnSubmissions)
      .values({ universityId: uni(actor), assignmentId: a.id, userId: actor.userId, batchId: seat.batchId })
      .onConflictDoNothing();
    const [s] = await tx
      .select()
      .from(asgnSubmissions)
      .where(and(eq(asgnSubmissions.assignmentId, a.id), eq(asgnSubmissions.userId, actor.userId)))
      .for("update");

    if (s.gradedAt) throw new ConflictError("Your work has been graded, so it can't be changed. Ask your teacher if you need to hand in again.");
    const late = now.getTime() > a.dueAt.getTime();
    if (late && !a.allowLate) throw new ValidationError("The due date has passed and this assignment doesn't take late work.");
    if (late && s.submittedAt) throw new ValidationError("The due date has passed, so work you've handed in can't be changed.");

    const text = (input.text ?? "").replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_TEXT_CHARS) throw new ValidationError(`Keep your answer under ${MAX_TEXT_CHARS.toLocaleString("en-IN")} characters, or upload it as a file.`);
    const newIds = [...new Set((input.fileIds ?? []).filter(Boolean))];
    let keep: (typeof asgnFiles.$inferSelect)[] = [];
    const [latest] = s.versionCount
      ? await tx.select().from(asgnSubmissionVersions).where(and(eq(asgnSubmissionVersions.submissionId, s.id), eq(asgnSubmissionVersions.version, s.versionCount)))
      : [];
    const keepIds = [...new Set((input.keepFileIds ?? []).filter(Boolean))];
    if (keepIds.length) {
      keep = latest
        ? await tx.select().from(asgnFiles).where(and(inArray(asgnFiles.id, keepIds), eq(asgnFiles.versionId, latest.id), eq(asgnFiles.purpose, "submission")))
        : [];
      if (keep.length !== keepIds.length) throw new ValidationError("A file you kept is no longer part of your work. Reload the page and try again.");
    }
    const fileCount = newIds.length + keep.length;
    if (a.submissionType === "text") {
      if (fileCount) throw new ValidationError("This assignment takes a written answer only. Remove the files.");
      if (!text) throw new ValidationError("Write your answer before handing in.");
    } else if (a.submissionType === "files") {
      if (!fileCount) throw new ValidationError("Upload at least one file before handing in.");
    } else if (!text && !fileCount) {
      throw new ValidationError("Write an answer or upload a file before handing in.");
    }
    if (fileCount > a.maxFiles) throw new ValidationError(`This assignment takes at most ${a.maxFiles} file${a.maxFiles === 1 ? "" : "s"}. Remove ${fileCount - a.maxFiles}.`);

    const version = s.versionCount + 1;
    const [v] = await tx
      .insert(asgnSubmissionVersions)
      .values({ universityId: uni(actor), submissionId: s.id, version, textAnswer: a.submissionType === "files" ? "" : text, submittedAt: now, late })
      .returning();
    await claimFiles(tx, actor, newIds, "submission", { assignmentId: a.id, submissionId: s.id, versionId: v.id });
    if (keep.length) {
      await tx.insert(asgnFiles).values(
        keep.map((f) => ({
          universityId: f.universityId,
          purpose: "submission" as const,
          assignmentId: a.id,
          submissionId: s.id,
          versionId: v.id,
          storageKey: f.storageKey,
          fileName: f.fileName,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          uploadedBy: f.uploadedBy,
          storedAt: f.storedAt,
          attachedAt: now,
        })),
      );
    }
    const [updated] = await tx
      .update(asgnSubmissions)
      .set({ batchId: seat.batchId, submittedAt: now, firstSubmittedAt: s.firstSubmittedAt ?? now, versionCount: version, late })
      .where(eq(asgnSubmissions.id, s.id))
      .returning();
    await audit(tx, actor, "assignment.submit", "asgn_submission", s.id, { assignmentId: a.id, version, late, files: fileCount });
    await emit(tx, actor, "assignment.submitted", { submissionId: s.id, assignmentId: a.id, userId: actor.userId, batchId: seat.batchId, late });
    return { submission: updated, version: v };
  });
}

/* ───────────────────────────── Jobs and events ───────────────────────────── */

/**
 * Daily: reminds students who haven't handed in, the day before the due date (or on the
 * day, when the assignment was set too late for a day-before reminder). Once per assignment
 * per due date.
 */
export async function remindDueSoon(actor: Actor, now = new Date()) {
  return withTenant(actor, async (tx) => {
    const u = await universityLite(tx);
    const horizon = new Date(now.getTime() + 2 * 86_400_000);
    const list = await tx
      .select()
      .from(asgnAssignments)
      .where(and(isNull(asgnAssignments.remindedAt), sql`${asgnAssignments.dueAt} > ${now.toISOString()}::timestamptz`, sql`${asgnAssignments.dueAt} <= ${horizon.toISOString()}::timestamptz`));
    const { calendarDaysUntil } = await import("../lib/time");
    let reminded = 0;
    for (const a of list) {
      if (calendarDaysUntil(a.dueAt, u.timezone, now) > 1) continue;
      const students = await studentsOf(tx, await coveredBatchIds(tx, a));
      const done = students.length
        ? (await tx
            .select({ userId: asgnSubmissions.userId })
            .from(asgnSubmissions)
            .where(and(eq(asgnSubmissions.assignmentId, a.id), inArray(asgnSubmissions.userId, students), sql`(${asgnSubmissions.submittedAt} is not null or ${asgnSubmissions.gradedAt} is not null)`))).map((r) => r.userId)
        : [];
      const waiting = students.filter((id) => !done.includes(id));
      const course = await getCourseLite(tx, a.courseId);
      await notify(tx, uni(actor), waiting, {
        kind: "assignment.due_soon",
        title: `${a.title} is ${dueLabel(a.dueAt, u.timezone, now).toLowerCase()}`,
        body: `${course.title}. You haven't handed it in yet.`,
        data: { assignmentId: a.id, href: `/${u.slug}/learn/assignments/${a.id}` },
      });
      await tx.update(asgnAssignments).set({ remindedAt: now }).where(eq(asgnAssignments.id, a.id));
      if (waiting.length) await audit(tx, actor, "assignment.remind", "assignment", a.id, { students: waiting.length });
      reminded += waiting.length;
    }
    return reminded;
  });
}

/**
 * enrolment.switched: work not graded yet moves with the student, so the new batch's
 * faculty grade it, as long as the assignment is set for the new batch too.
 */
export async function followBatchSwitch(tx: Tx, p: { userId: string; courseId: string; fromBatchId: string; toBatchId: string }) {
  const subs = await tx
    .select({ id: asgnSubmissions.id, assignmentId: asgnSubmissions.assignmentId })
    .from(asgnSubmissions)
    .innerJoin(asgnAssignments, eq(asgnAssignments.id, asgnSubmissions.assignmentId))
    .where(and(eq(asgnSubmissions.userId, p.userId), eq(asgnSubmissions.batchId, p.fromBatchId), eq(asgnAssignments.courseId, p.courseId), isNull(asgnSubmissions.gradedAt)));
  if (subs.length === 0) return 0;
  const list = await tx.select().from(asgnAssignments).where(inArray(asgnAssignments.id, subs.map((s) => s.assignmentId)));
  const covered = await coveredBatchMap(tx, list);
  const move = subs.filter((s) => (covered.get(s.assignmentId) ?? []).includes(p.toBatchId)).map((s) => s.id);
  if (move.length) await tx.update(asgnSubmissions).set({ batchId: p.toBatchId }).where(inArray(asgnSubmissions.id, move));
  return move.length;
}

/* ───────────────────────────── Dashboard and hub ───────────────────────────── */

export type ToGradeItem = { assignmentId: string; title: string; courseTitle: string; batchId: string; batchName: string; count: number; late: number; oldest: Date; dueAt: Date };

/** Work waiting for a grade, in the batches the actor grades, oldest first. */
export async function toGradeSummary(actor: Actor): Promise<ToGradeItem[]> {
  const r = reach(actor, "assignment.grade", uni(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        assignmentId: asgnSubmissions.assignmentId,
        batchId: asgnSubmissions.batchId,
        departmentId: asgnAssignments.departmentId,
        courseId: asgnAssignments.courseId,
        title: asgnAssignments.title,
        dueAt: asgnAssignments.dueAt,
        count: sql<number>`count(*)::int`,
        late: sql<number>`count(*) filter (where ${asgnSubmissions.late})::int`,
        oldest: sql<string>`min(${asgnSubmissions.submittedAt})`,
      })
      .from(asgnSubmissions)
      .innerJoin(asgnAssignments, eq(asgnAssignments.id, asgnSubmissions.assignmentId))
      .where(and(isNotNull(asgnSubmissions.submittedAt), isNull(asgnSubmissions.gradedAt)))
      .groupBy(asgnSubmissions.assignmentId, asgnSubmissions.batchId, asgnAssignments.departmentId, asgnAssignments.courseId, asgnAssignments.title, asgnAssignments.dueAt);
    const mine = rows.filter((x) => batchesWhere(actor, "assignment.grade", x.departmentId, [x.batchId]).length === 1);
    const n = await names(tx, mine.map((x) => x.courseId), mine.map((x) => x.batchId));
    return mine
      .map((x) => ({
        assignmentId: x.assignmentId,
        title: x.title,
        courseTitle: n.course.get(x.courseId) ?? "",
        batchId: x.batchId,
        batchName: n.batch.get(x.batchId) ?? "",
        count: x.count,
        late: x.late,
        oldest: new Date(x.oldest),
        dueAt: x.dueAt,
      }))
      .sort((x, y) => x.oldest.getTime() - y.oldest.getTime());
  });
}

/** Graded work for the hub, newest grade first. */
export async function myGrades(actor: Actor) {
  const list = await myAssignments(actor);
  return list.filter((a) => a.status === "graded").sort((x, y) => (y.gradedAt?.getTime() ?? 0) - (x.gradedAt?.getTime() ?? 0));
}

export { MAX_UPLOAD_MB };
export type { FileView };
// Re-exported for pages that order assignments the same way.
export { asc };
