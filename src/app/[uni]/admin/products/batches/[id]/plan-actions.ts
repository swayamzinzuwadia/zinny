"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { clashSentence } from "@/server/lib/clashes";
import { addStudentToBatch } from "@/server/services/enrolment";
import { copyPlan, createSection, deleteSection, moveSection, planDaysFromText, setIncharge, updateSection, type PlanDayInput } from "@/server/services/batch-plan";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const batchId = str(data, "batchId");
  const { actor } = await spaceContext(uni);
  return { uni, batchId, actor, refresh: () => revalidatePath(`/${uni}/admin/products/batches/${batchId}`) };
}

/** Says who was told, so nobody wonders whether students know. */
const told = (n: number) => (n === 0 ? "" : n === 1 ? " 1 student was told the plan changed." : ` ${n} students were told the plan changed.`);

/** Topic and times typed against each day (fields named topic-7, start-7, end-7). */
function dayDetails(data: FormData) {
  const details: Record<number, Omit<PlanDayInput, "dayNumber">> = {};
  for (const [key, value] of data.entries()) {
    const m = /^(topic|start|end)-(\d+)$/.exec(key);
    if (!m) continue;
    const day = Number(m[2]);
    const text = String(value).trim();
    details[day] ??= {};
    if (m[1] === "topic") details[day].topic = text || null;
    if (m[1] === "start") details[day].startTime = text || null;
    if (m[1] === "end") details[day].endTime = text || null;
  }
  return details;
}

export async function setInchargeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, batchId, refresh } = await ctx(data);
  return attempt(async () => {
    const userId = str(data, "userId") || null;
    const r = await setIncharge(actor, batchId, userId);
    refresh();
    if (!r.changed) return userId ? "They are already the incharge." : "This batch has no incharge.";
    return userId ? `${r.name} is now the incharge of this batch.` : "This batch has no incharge now.";
  });
}

export async function createSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, batchId, refresh } = await ctx(data);
  return attempt(async () => {
    const r = await createSection(actor, batchId, {
      title: str(data, "title"),
      description: str(data, "description"),
      facultyUserId: str(data, "facultyUserId") || null,
      days: planDaysFromText(str(data, "days")),
    });
    refresh();
    return `${r.section.title} added.${told(r.studentsNotified)}`;
  });
}

export async function saveSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, refresh } = await ctx(data);
  return attempt(async () => {
    const sectionId = str(data, "sectionId");
    if (!sectionId) throw new ValidationError("Reload the page and try again.");
    const r = await updateSection(actor, sectionId, {
      title: str(data, "title"),
      description: str(data, "description"),
      facultyUserId: str(data, "facultyUserId") || null,
      days: planDaysFromText(str(data, "days"), dayDetails(data)),
    });
    refresh();
    return `${r.title} saved.${told(r.studentsNotified)}`;
  });
}

export async function moveSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, refresh } = await ctx(data);
  return attempt(async () => {
    const r = await moveSection(actor, str(data, "sectionId"), str(data, "direction") === "up" ? "up" : "down");
    refresh();
    return `Order saved.${told(r.studentsNotified)}`;
  });
}

export async function deleteSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, refresh } = await ctx(data);
  return attempt(async () => {
    const r = await deleteSection(actor, str(data, "sectionId"));
    refresh();
    return `${r.title} removed.${told(r.studentsNotified)}`;
  });
}

export async function copyPlanAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, batchId, refresh } = await ctx(data);
  return attempt(async () => {
    const from = str(data, "fromBatchId");
    if (!from) throw new ValidationError("Pick the batch to copy from.");
    const r = await copyPlan(actor, batchId, from);
    refresh();
    const missing = r.withoutFaculty.length
      ? ` ${r.withoutFaculty.join(", ")} ${r.withoutFaculty.length === 1 ? "has" : "have"} no faculty here: pick who teaches ${r.withoutFaculty.length === 1 ? "it" : "them"}.`
      : "";
    return `Copied ${r.sections} ${r.sections === 1 ? "section" : "sections"} from ${r.fromBatchName}.${missing}${told(r.studentsNotified)}`;
  });
}

export type AddStudentState = (NonNullable<ActionState> & { clash?: { email: string; warning: string } }) | null;

/** Adds a student to the batch. A clash comes back as a warning first; pressing again adds them anyway. */
export async function addStudentAction(_: AddStudentState, data: FormData): Promise<AddStudentState> {
  const { uni, actor, batchId } = await ctx(data);
  const email = str(data, "email").toLowerCase();
  const found: { clash?: { email: string; warning: string } } = {};
  const res = await attempt(async () => {
    const r = await addStudentToBatch(actor, { batchId, email, acknowledgeClash: !!email && str(data, "acknowledge").toLowerCase() === email });
    if (r.status === "clash") {
      found.clash = { email, warning: clashSentence(r.clashes, `${r.student.name}'s place in this batch`) };
      return;
    }
    revalidatePath(`/${uni}/admin/products/batches/${batchId}`);
    return `${r.student.name} is in the batch and has been told. It's on their timetable now.${r.clashes.length > 0 ? " Their timetable marks the classes that clash." : ""}`;
  });
  return found.clash ? { clash: found.clash, at: Date.now() } : res;
}
