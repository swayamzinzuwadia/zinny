"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import type { RoleName } from "@/db/schema";
import { attempt, num, rupeesToPaise, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { addSessionOverride, assignFaculty, createBatch, removeFaculty, updateBatch } from "@/server/services/batches";
import { createCourse, updateCourse } from "@/server/services/courses";
import { createDepartment, setHod } from "@/server/services/departments";
import { decideSwitch } from "@/server/services/enrolment";
import type { Slot } from "@/server/services/schedule";
import { addPerson, graduate, importPeople, linkParent, revokeRole } from "@/server/services/users";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

/** Days come in as checkboxes (day=1..7), with one start and end time for all of them. */
function slotsFrom(data: FormData): Slot[] {
  const start = str(data, "startTime");
  const end = str(data, "endTime");
  return data.getAll("day").map((d) => ({ weekday: Number(d), startTime: start, endTime: end }));
}

/* ── Courses ── */

export async function createCourseAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let id = "";
  const res = await attempt(async () => {
    const c = await createCourse(actor, {
      departmentId: str(data, "departmentId"),
      title: str(data, "title"),
      description: str(data, "description"),
      pricePaise: rupeesToPaise(str(data, "price")),
      gstRateBp: num(data, "gst") * 100,
    });
    id = c.id;
  });
  if (id) redirect(`/${uni}/admin/products/courses/${id}?tab=batches`);
  return res;
}

export async function updateCourseAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    await updateCourse(actor, courseId, {
      title: str(data, "title"),
      description: str(data, "description"),
      pricePaise: rupeesToPaise(str(data, "price")),
      gstRateBp: num(data, "gst") * 100,
      certificateEnabled: data.get("certificate") === "on",
    });
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    return "Course saved.";
  });
}

export async function setCourseStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  const status = str(data, "status") as "draft" | "published" | "archived";
  return attempt(async () => {
    await updateCourse(actor, courseId, { status });
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    return status === "published" ? "Published. Students can enrol now." : `Course is now ${status}.`;
  });
}

/* ── Batches ── */

export async function createBatchAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    const facultyIds = data.getAll("faculty").map(String).filter(Boolean);
    const visiting = new Set(data.getAll("visiting").map(String));
    await createBatch(actor, {
      courseId,
      name: str(data, "name"),
      startDate: str(data, "startDate"),
      endDate: str(data, "endDate"),
      seatLimit: num(data, "seatLimit"),
      meetingUrl: str(data, "meetingUrl") || null,
      slots: slotsFrom(data),
      faculty: facultyIds.map((userId) => ({ userId, role: visiting.has(userId) ? "visiting_faculty" : "permanent_faculty" })),
    });
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    return "Batch created.";
  });
}

export async function updateBatchAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    const days = data.getAll("day");
    await updateBatch(actor, batchId, {
      name: str(data, "name"),
      startDate: str(data, "startDate"),
      endDate: str(data, "endDate"),
      seatLimit: num(data, "seatLimit"),
      meetingUrl: str(data, "meetingUrl"),
      ...(days.length > 0 && { slots: slotsFrom(data) }),
      status: (str(data, "status") || undefined) as "open" | "closed" | undefined,
    });
    revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
    return "Batch saved. Students were notified if timings changed.";
  });
}

export async function overrideAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    const kind = str(data, "kind") as "cancelled" | "rescheduled" | "extra";
    await addSessionOverride(actor, batchId, {
      date: str(data, "date"),
      kind,
      newDate: str(data, "newDate") || undefined,
      startTime: str(data, "startTime") || undefined,
      endTime: str(data, "endTime") || undefined,
      note: str(data, "note") || undefined,
    });
    revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
    return "Done. Students in this batch were notified.";
  });
}

export async function addFacultyAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    const userId = str(data, "userId");
    if (!userId) throw new ValidationError("Pick a faculty member.");
    await assignFaculty(actor, batchId, { userId, role: str(data, "role") === "visiting_faculty" ? "visiting_faculty" : "permanent_faculty" });
    revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
    return "Faculty added.";
  });
}

export async function removeFacultyAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    await removeFaculty(actor, batchId, str(data, "userId"));
    revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
    return "Faculty removed.";
  });
}

export async function decideSwitchAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const [decision, requestId] = str(data, "choice").split("|");
    const r = await decideSwitch(actor, requestId, { approve: decision === "approve", note: str(data, "note") });
    revalidatePath(`/${uni}/admin`, "layout");
    if (r.status === "approved") return "Approved. The student's timetable is updated.";
    return r.reason === "batch_full" ? "Couldn't approve: that batch has no free seat. The student was told." : "Request declined.";
  });
}

/* ── People ── */

export async function addPersonAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const endsAt = str(data, "endsAt");
    await addPerson(actor, {
      name: str(data, "name"),
      email: str(data, "email"),
      phone: str(data, "phone"),
      role: str(data, "role") as RoleName,
      departmentId: str(data, "departmentId") || null,
      endsAt: endsAt ? new Date(`${endsAt}T23:59:59+05:30`) : null,
    });
    revalidatePath(`/${uni}/admin/users`, "layout");
    return "Added.";
  });
}

export async function revokeRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await revokeRole(actor, str(data, "assignmentId"));
    revalidatePath(`/${uni}/admin/users`, "layout");
    return "Role removed.";
  });
}

export async function graduateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const r = await graduate(actor, str(data, "userId"));
    revalidatePath(`/${uni}/admin/users`, "layout");
    return `Moved to alumni. ${r.endedEnrolments} program course${r.endedEnrolments === 1 ? "" : "s"} removed; certificates kept.`;
  });
}

export async function linkParentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await linkParent(actor, { studentUserId: str(data, "userId"), parentEmail: str(data, "parentEmail"), parentName: str(data, "parentName") });
    revalidatePath(`/${uni}/admin/users`, "layout");
    return "Parent linked. They get a read-only view.";
  });
}

export async function createDepartmentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await createDepartment(actor, { code: str(data, "code"), name: str(data, "name") });
    revalidatePath(`/${uni}/admin/users/departments`);
    return "Department created.";
  });
}

export async function setHodAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await setHod(actor, str(data, "departmentId"), str(data, "userId"));
    revalidatePath(`/${uni}/admin/users`, "layout");
    return "Head of Department updated.";
  });
}

export type ImportState = (NonNullable<ActionState> & { result?: Awaited<ReturnType<typeof importPeople>>; csv?: string }) | null;

export async function importAction(_: ImportState, data: FormData): Promise<ImportState> {
  const { uni, actor } = await ctx(data);
  const file = data.get("file");
  const csv = file instanceof File && file.size > 0 ? await file.text() : str(data, "csv");
  const commit = str(data, "mode") === "commit";
  let result: Awaited<ReturnType<typeof importPeople>> | undefined;
  const res = await attempt(async () => {
    result = await importPeople(actor, csv, { commit });
    revalidatePath(`/${uni}/admin/users`, "layout");
    if (result.errors > 0) throw new ValidationError(`${result.errors} row${result.errors === 1 ? "" : "s"} need fixing. Nothing was imported.`);
    return commit ? `Imported ${result.saved} people.` : `All ${result.total} rows look good. Import them when ready.`;
  });
  return { ...res, result, csv };
}
