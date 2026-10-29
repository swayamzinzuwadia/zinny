"use server";

/** Server actions: read the form, call the service, refresh the pages that show the change. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { courseTab, learnAssignment, learnBase, pollsBase, staffAssignment, staffBase } from "./links";
import {
  createAssignment,
  deleteAssignment,
  gradeSubmission,
  submitAssignment,
  updateAssignment,
  type AssignmentPatch,
  type SubmissionType,
} from "./service/assignments";
import { closePoll, createPoll, deletePoll, vote } from "./service/polls";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

const all = (d: FormData, k: string) => d.getAll(k).map((v) => String(v).trim()).filter(Boolean);
const checked = (d: FormData, k: string) => d.get(k) === "on" || d.get(k) === "1";

function assignmentFields(data: FormData): AssignmentPatch {
  const scope = str(data, "scope");
  return {
    title: str(data, "title"),
    instructionsHtml: String(data.get("instructions") ?? ""),
    dueDate: str(data, "dueDate"),
    dueTime: str(data, "dueTime"),
    points: Number(str(data, "points")),
    allowLate: checked(data, "allowLate"),
    latePenaltyPct: Number(str(data, "latePenaltyPct") || "0"),
    submissionType: (str(data, "submissionType") || "both") as SubmissionType,
    maxFiles: Number(str(data, "maxFiles") || "1"),
    maxFileMb: Number(str(data, "maxFileMb") || "10"),
    batchIds: scope === "all" ? "all" : all(data, "batchId"),
    attachmentIds: all(data, "fileIds"),
    removeAttachmentIds: all(data, "removeFileIds"),
  };
}

/* ── Assignments (staff) ── */

export async function createAssignmentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  let id = "";
  const res = await attempt(async () => {
    const { removeAttachmentIds: _r, ...fields } = assignmentFields(data);
    void _r;
    id = (await createAssignment(actor, { courseId, ...fields })).id;
  });
  if (id) {
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    redirect(staffAssignment(uni, id));
  }
  return res;
}

export async function updateAssignmentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const id = str(data, "assignmentId");
  let done = false;
  const res = await attempt(async () => {
    await updateAssignment(actor, id, assignmentFields(data));
    done = true;
  });
  if (done) {
    revalidatePath(staffBase(uni), "layout");
    redirect(staffAssignment(uni, id));
  }
  return res;
}

export async function deleteAssignmentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  let done = false;
  const res = await attempt(async () => {
    await deleteAssignment(actor, str(data, "assignmentId"));
    done = true;
  });
  if (done) {
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    redirect(courseTab(uni, courseId, "assignments"));
  }
  return res;
}

/** Saves a grade, then opens the next student still waiting in the batch (when asked to). */
export async function gradeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const assignmentId = str(data, "assignmentId");
  const batchId = str(data, "batchId");
  const next = str(data, "next");
  let saved = false;
  const res = await attempt(async () => {
    await gradeSubmission(actor, {
      assignmentId,
      studentId: str(data, "studentId"),
      marks: str(data, "marks"),
      feedback: String(data.get("feedback") ?? ""),
      returnedFileIds: all(data, "fileIds"),
      removeReturnedIds: all(data, "removeFileIds"),
    });
    saved = true;
    return "Grade saved. The student has been told.";
  });
  if (saved) {
    revalidatePath(staffBase(uni), "layout");
    if (next) redirect(staffAssignment(uni, assignmentId, { batch: batchId, student: next }));
  }
  return res;
}

/* ── Assignments (students) ── */

export async function submitAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const assignmentId = str(data, "assignmentId");
  const res = await attempt(async () => {
    const { submission } = await submitAssignment(actor, {
      assignmentId,
      text: String(data.get("text") ?? ""),
      fileIds: all(data, "fileIds"),
      keepFileIds: all(data, "keepFileIds"),
    });
    return submission.late ? "Handed in late. Your teacher can see when it arrived." : submission.versionCount > 1 ? "Handed in again. Your earlier versions are kept." : "Handed in. You can change it until the due date.";
  });
  if (res?.ok) {
    revalidatePath(learnAssignment(uni, assignmentId));
    revalidatePath(learnBase(uni));
  }
  return res;
}

/* ── Polls ── */

export async function createPollAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    const scope = str(data, "batchId");
    await createPoll(actor, {
      courseId,
      batchId: scope === "all" ? null : scope,
      question: str(data, "question"),
      options: data.getAll("option").map(String),
      anonymous: checked(data, "anonymous"),
      resultsToStudents: checked(data, "resultsToStudents"),
      opensDate: str(data, "opensDate"),
      opensTime: str(data, "opensTime"),
      closesDate: str(data, "closesDate"),
      closesTime: str(data, "closesTime"),
    });
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    return "Poll added.";
  });
}

export async function closePollAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await closePoll(actor, str(data, "pollId"));
    revalidatePath(`/${uni}/admin/products/courses/${str(data, "courseId")}`);
    return "Poll closed.";
  });
}

export async function deletePollAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await deletePoll(actor, str(data, "pollId"));
    revalidatePath(`/${uni}/admin/products/courses/${str(data, "courseId")}`);
    return "Poll deleted.";
  });
}

export async function voteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const optionId = str(data, "optionId");
    if (!optionId) throw new ValidationError("Pick an option first.");
    await vote(actor, str(data, "pollId"), optionId);
    revalidatePath(pollsBase(uni));
    revalidatePath(`/${uni}/learn`, "layout");
    return "Vote recorded. Thanks for voting.";
  });
}
