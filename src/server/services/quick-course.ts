/**
 * The "New course" flow: a course, its department, its first batch, the people who teach
 * it and publishing, saved together in one transaction. It reuses each service's own rules
 * (createDepartmentTx, addPersonTx, createCourseTx, createBatchTx, updateCourseTx), so
 * nothing here is a second copy of a rule; it only decides the order and the defaults.
 * If any part fails, nothing is saved.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, departments, roleAssignments, users } from "@/db/schema";
import { assertCan, can, type Actor } from "../authz/engine";
import { AppError, ForbiddenError, ValidationError } from "../errors";
import { addDays, isoWeekday, todayIn } from "../lib/dates";
import { audit, withTenant } from "../tenant";
import { checkBatchInput, createBatchTx, type BatchInput, type FacultyInput } from "./batches";
import { createCourseTx, loadCourse, updateCourseTx } from "./courses";
import { createDepartmentTx, freeDepartmentCode } from "./departments";
import type { Slot } from "./schedule";
import { addPersonTx, canAddTeachers, teachMyselfTx } from "./users";
import { setInchargeTx } from "./batch-plan";
import { modules } from "../registry";
import { createBatchListingTx } from "@/modules/marketplace/listings";

const TEACHING_ROLES = ["hod", "permanent_faculty", "visiting_faculty"] as const;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function uni(actor: Actor) {
  return actor.universityId!;
}

/** Which part of the form an error belongs to, so the page can show it there. */
export type QuickSection = "course" | "department" | "batch" | "teachers" | "publish";

export type QuickCourseInput = {
  title: string;
  description?: string;
  pricePaise: number;
  /** Left out when the institute doesn't show GST: the course default applies. */
  gstRateBp?: number;
  /** An existing department, or `newDepartmentName` to make one here. */
  departmentId?: string | null;
  newDepartmentName?: string | null;
  /** The first batch. Null to add batches later. */
  batch?: {
    name: string;
    startDate: string;
    endDate: string;
    seatLimit: number;
    slots: Slot[];
    meetingUrl?: string | null;
  } | null;
  /** People already teaching in the department. */
  teacherIds?: string[];
  /** New teachers: added as permanent faculty of the department and sent an invitation. */
  newTeachers?: { name: string; email: string }[];
  /** The person filling the form teaches it too. */
  teachMyself?: boolean;
  /** Publish now, so students can enrol. Needs the batch. */
  publish?: boolean;
  /**
   * Who runs the batch: an existing teacher's id, "me", or "new:<email>" for a teacher added
   * here. Left out, it is the person themselves when they teach it, else the first teacher.
   */
  incharge?: string | null;
  /** Also sell seats in the first batch on the marketplace, at this price before GST. Needs the batch. */
  marketplace?: { pricePaise: number; lateJoin?: boolean } | null;
};

export type QuickCourseResult = {
  courseId: string;
  batchId: string | null;
  departmentId: string;
  departmentCreated: boolean;
  teachersAdded: number;
  published: boolean;
  /** The live batch listing, when the first batch was put on the marketplace. */
  listingId: string | null;
};

/** The marketplace is a module: selling a live batch from here needs it installed. */
export function marketplaceInstalled() {
  return modules().some((m) => m.id === "marketplace");
}

/** A ValidationError that says which part of the form to fix. */
function inSection(section: QuickSection, e: unknown): never {
  if (e instanceof ValidationError || (e instanceof AppError && e.code !== "forbidden" && e.status === 409)) {
    throw new ValidationError(e.message, e.code, { section });
  }
  throw e;
}

async function part<T>(section: QuickSection, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    inSection(section, e);
  }
}

/** Everything that can be checked before opening a transaction, in the order the form shows it. */
function precheck(actor: Actor, input: QuickCourseInput) {
  const universityId = uni(actor);
  const fail = (section: QuickSection, message: string): never => {
    throw new ValidationError(message, "invalid", { section });
  };
  // Permission first: a course in this department (a department made here is checked when it exists).
  if (input.departmentId) assertCan(actor, "course.create", { universityId, departmentIds: [input.departmentId] });
  if (input.title.trim().length < 3) fail("course", "Give the course a title of at least 3 characters.");
  if (!Number.isInteger(input.pricePaise) || input.pricePaise < 0) fail("course", "Enter a price of 0 or more. 0 means free.");

  const newName = input.newDepartmentName?.trim() ?? "";
  if (!input.departmentId && !newName) fail("department", "Pick a department, or type a name for a new one.");
  if (!input.departmentId && newName.length < 2) fail("department", "Type a department name of at least 2 characters, like General.");
  if (!input.departmentId && !can(actor, "department.manage", { universityId }))
    fail("department", "You can't create departments. Pick one of yours, or ask an institute admin to add one.");

  const newTeachers = input.newTeachers ?? [];
  for (const t of newTeachers) {
    if (t.name.trim().length < 2) fail("teachers", "Enter the new teacher's full name.");
    if (!emailRe.test(t.email.trim())) fail("teachers", `"${t.email.trim() || "(empty)"}" isn't a valid email. Check the new teacher's email.`);
  }
  const teachers = (input.teacherIds?.length ?? 0) + newTeachers.length + (input.teachMyself ? 1 : 0);

  if (input.batch) {
    if (teachers === 0) fail("teachers", "A batch needs at least one teacher. Pick someone, add a new teacher, or choose \"I'll teach it myself\".");
    // The batch's own checks, with a stand-in teacher (the real ones are added in the transaction).
    try {
      checkBatchInput({ courseId: "", ...input.batch, faculty: [{ userId: "", role: "permanent_faculty" }] });
    } catch (e) {
      inSection("batch", e);
    }
  }
  if (input.publish && !input.batch) fail("publish", "Students enrol in a batch, so publishing needs the first batch. Add it, or untick \"Publish now\".");
  if (input.marketplace) {
    if (!marketplaceInstalled()) fail("publish", "The marketplace isn't available here. Untick \"Also sell a seat on the marketplace\".");
    if (!input.batch) fail("publish", "The marketplace sells seats in a batch. Add the first batch, or untick \"Also sell a seat on the marketplace\".");
    if (!Number.isInteger(input.marketplace.pricePaise) || input.marketplace.pricePaise < 100)
      fail("publish", "Set a marketplace price of at least ₹1. The marketplace sells paid seats only.");
  }
}

/** The incharge picked on the form, as a user id: see QuickCourseInput.incharge. */
function inchargeId(input: QuickCourseInput, actor: Actor, newIds: Map<string, string>, facultyIds: string[]): string | null {
  const pick = input.incharge;
  if (pick === "me") return actor.userId;
  if (pick?.startsWith("new:")) return newIds.get(pick.slice(4).trim().toLowerCase()) ?? null;
  if (pick) return pick;
  if (input.teachMyself) return actor.userId;
  return facultyIds[0] ?? null;
}

export async function createCourseQuickly(actor: Actor, input: QuickCourseInput): Promise<QuickCourseResult> {
  precheck(actor, input);
  return withTenant(actor, async (tx) => {
    // 1. Department: an existing one, or a new one made here.
    let departmentId = input.departmentId ?? "";
    let departmentCreated = false;
    if (!departmentId) {
      const name = input.newDepartmentName!.trim();
      const dept = await part("department", async () => createDepartmentTx(tx, actor, { code: await freeDepartmentCode(tx, name), name }));
      departmentId = dept.id;
      departmentCreated = true;
    }

    // 2. The course.
    const course = await part("course", () =>
      createCourseTx(tx, actor, {
        departmentId,
        title: input.title,
        description: input.description,
        pricePaise: input.pricePaise,
        gstRateBp: input.gstRateBp,
      }),
    );

    // 3. Teaching staff: new teachers and the person themselves join the department first.
    const facultyIds = new Set(input.teacherIds ?? []);
    const newIds = new Map<string, string>();
    let teachersAdded = 0;
    await part("teachers", async () => {
      if ((input.newTeachers?.length || input.teachMyself) && !canAddTeachers(actor, departmentId))
        throw new ForbiddenError("You can't add teaching staff to this department. Pick people who already teach in it.");
      for (const t of input.newTeachers ?? []) {
        const id = await addPersonTx(tx, actor, { name: t.name, email: t.email, role: "permanent_faculty", departmentId });
        facultyIds.add(id);
        newIds.set(t.email.trim().toLowerCase(), id);
        teachersAdded++;
      }
      if (input.teachMyself) {
        await teachMyselfTx(tx, actor, departmentId);
        facultyIds.add(actor.userId);
      }
    }).catch((e) => {
      // A missing permission is a form problem here, not a crash: say which part.
      if (e instanceof ForbiddenError) throw new ValidationError(e.message, "forbidden", { section: "teachers" });
      throw e;
    });

    // 4. The first batch, taught by everyone picked above.
    let batchId: string | null = null;
    if (input.batch) {
      const faculty = await part("teachers", () => facultyRoles(tx, departmentId, [...facultyIds]));
      const batch = await part("batch", () => createBatchTx(tx, actor, { courseId: course.id, ...input.batch!, faculty }));
      batchId = batch.id;
      // Its incharge: one of its teachers (the batch plan's own rules decide who may be one).
      const incharge = inchargeId(input, actor, newIds, [...facultyIds]);
      if (incharge) await part("teachers", () => setInchargeTx(tx, actor, batch.id, incharge));
    }

    // 5. Publish.
    if (input.publish) await part("publish", () => updateCourseTx(tx, actor, course.id, { status: "published" }));

    // 6. A seat in the batch on the marketplace, with the marketplace's own listing rules.
    let listingId: string | null = null;
    if (input.marketplace && batchId) {
      const listing = await part("publish", () =>
        createBatchListingTx(tx, actor, {
          batchId: batchId!,
          description: input.description ?? "",
          pricePaise: input.marketplace!.pricePaise,
          lateJoin: input.marketplace!.lateJoin ?? false,
        }),
      );
      listingId = listing.id;
    }

    await audit(tx, actor, "course.quick_create", "course", course.id, {
      departmentId,
      departmentCreated,
      batchId,
      teachers: facultyIds.size,
      teachersAdded,
      published: !!input.publish,
      listingId,
    });
    return { courseId: course.id, batchId, departmentId, departmentCreated, teachersAdded, published: !!input.publish, listingId };
  });
}

/**
 * The course page's "Add a batch": the same as createBatch, but the form can also add a new
 * teacher or the person themselves to the department's teaching staff, in the same
 * transaction, instead of sending them to Users first.
 */
export async function createBatchWithTeachers(
  actor: Actor,
  input: Omit<BatchInput, "faculty"> & { teacherIds: string[]; newTeachers?: { name: string; email: string }[]; teachMyself?: boolean },
) {
  const { teacherIds, teachMyself, newTeachers: typed, ...batch } = input;
  const newTeachers = (typed ?? []).filter((t) => t.name.trim() || t.email.trim());
  for (const t of newTeachers) {
    if (t.name.trim().length < 2) throw new ValidationError("Enter the new teacher's full name.");
    if (!emailRe.test(t.email.trim())) throw new ValidationError(`"${t.email.trim() || "(empty)"}" isn't a valid email. Check the new teacher's email.`);
  }
  const count = teacherIds.length + newTeachers.length + (teachMyself ? 1 : 0);
  // The batch's own checks first, with a stand-in teacher when someone is being added.
  checkBatchInput({ ...batch, faculty: count ? [{ userId: "", role: "permanent_faculty" }] : [] });
  return withTenant(actor, async (tx) => {
    const { course } = await loadCourse(tx, uni(actor), batch.courseId);
    assertCan(actor, "batch.create", { universityId: uni(actor), departmentIds: [course.departmentId] });
    const ids = new Set(teacherIds);
    if ((newTeachers.length || teachMyself) && !canAddTeachers(actor, course.departmentId))
      throw new ForbiddenError("You can't add teaching staff to this department. Pick people who already teach in it.");
    for (const t of newTeachers) ids.add(await addPersonTx(tx, actor, { name: t.name, email: t.email, role: "permanent_faculty", departmentId: course.departmentId }));
    if (teachMyself) {
      await teachMyselfTx(tx, actor, course.departmentId);
      ids.add(actor.userId);
    }
    return createBatchTx(tx, actor, { ...batch, faculty: await facultyRoles(tx, course.departmentId, [...ids]) });
  });
}

/** Each teacher's batch role: visiting faculty stay visiting (their access end date carries over). */
async function facultyRoles(tx: Tx, departmentId: string, userIds: string[]): Promise<FacultyInput[]> {
  if (userIds.length === 0) return [];
  const now = new Date();
  const rows = (
    await tx
      .select({ userId: roleAssignments.userId, role: roleAssignments.role, endsAt: roleAssignments.endsAt })
      .from(roleAssignments)
      .where(
        and(
          inArray(roleAssignments.userId, userIds),
          eq(roleAssignments.departmentId, departmentId),
          inArray(roleAssignments.role, [...TEACHING_ROLES]),
          isNull(roleAssignments.revokedAt),
        ),
      )
  ).filter((r) => !r.endsAt || r.endsAt > now);
  return userIds.map((userId) => {
    const mine = rows.filter((r) => r.userId === userId);
    const visitingOnly = mine.length > 0 && mine.every((r) => r.role === "visiting_faculty");
    return { userId, role: visitingOnly ? "visiting_faculty" : "permanent_faculty" };
  });
}

/* ─────────────────────────── What the form needs ─────────────────────────── */

export type QuickCourseOptions = {
  /** Departments this person can create a course in, each with the people who teach there. */
  departments: { id: string; name: string; staff: { id: string; name: string; visiting: boolean }[]; canAddTeachers: boolean }[];
  canCreateDepartment: boolean;
  /** Can add teachers to a department made here (institute-wide role management). */
  canAddTeachersAnywhere: boolean;
  /** No batch exists yet in the institute: the first-batch section starts open. */
  firstBatch: boolean;
  defaults: { startDate: string; endDate: string };
};

/** The next Monday after today (in the institute's time zone), and 12 weeks on. */
export function batchDateDefaults(today: string) {
  const wd = isoWeekday(today);
  const startDate = addDays(today, wd === 1 ? 7 : 8 - wd);
  return { startDate, endDate: addDays(startDate, 12 * 7 - 1) };
}

export async function quickCourseOptions(actor: Actor, timezone: string): Promise<QuickCourseOptions> {
  const universityId = uni(actor);
  const canCreateDepartment = can(actor, "department.manage", { universityId });
  return withTenant(actor, async (tx) => {
    const all = await tx.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name);
    const mine = all.filter((d) => can(actor, "course.create", { universityId, departmentIds: [d.id] }));
    const now = new Date();
    const staff = mine.length
      ? (
          await tx
            .select({ departmentId: roleAssignments.departmentId, id: users.id, name: users.name, role: roleAssignments.role, endsAt: roleAssignments.endsAt })
            .from(roleAssignments)
            .innerJoin(users, eq(users.id, roleAssignments.userId))
            .where(
              and(
                isNull(roleAssignments.revokedAt),
                eq(roleAssignments.scopeType, "department"),
                inArray(roleAssignments.role, [...TEACHING_ROLES]),
                inArray(
                  roleAssignments.departmentId,
                  mine.map((d) => d.id),
                ),
              ),
            )
            .orderBy(users.name)
        ).filter((r) => !r.endsAt || r.endsAt > now)
      : [];
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(batches).where(eq(batches.recorded, false));
    return {
      departments: mine.map((d) => {
        const people = new Map<string, { id: string; name: string; visiting: boolean }>();
        for (const s of staff.filter((x) => x.departmentId === d.id)) {
          const prev = people.get(s.id);
          people.set(s.id, { id: s.id, name: s.name, visiting: (prev?.visiting ?? true) && s.role === "visiting_faculty" });
        }
        return { ...d, staff: [...people.values()], canAddTeachers: canAddTeachers(actor, d.id) };
      }),
      canCreateDepartment,
      canAddTeachersAnywhere: canAddTeachers(actor, null),
      firstBatch: n === 0,
      defaults: batchDateDefaults(todayIn(timezone)),
    };
  });
}
