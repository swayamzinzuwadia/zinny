"use server";

/**
 * Server actions for the curriculum editor, the lesson player and the staff progress view.
 * Each one builds the actor from the session and calls a service; the services check
 * permissions and write the audit log.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { markLessonComplete, recordLessonOpened } from "./learn";
import {
  addLesson,
  addSection,
  clearLessonContent,
  deleteLesson,
  deleteSection,
  moveLesson,
  moveSection,
  renameSection,
  setLessonKind,
  setLinkContent,
  setTextContent,
  setVideoLink,
  updateLesson,
  type DripInput,
} from "./service";
import { markStudentComplete } from "./staff";
import { batchProgressPath, curriculumPath, lessonEditorPath, lessonPath } from "./paths";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

/** Like `attempt`, without a success message (for moves, where the list itself shows the result). */
async function quiet(fn: () => Promise<unknown>): Promise<ActionState> {
  try {
    await fn();
    return { at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { error: e.message, at: Date.now() };
    console.error(e);
    return { error: "Something went wrong. Please try again.", at: Date.now() };
  }
}

const direction = (data: FormData) => (str(data, "direction") === "up" ? "up" : "down");

function refreshCourse(uni: string, courseId: string) {
  revalidatePath(curriculumPath(uni, courseId));
}

/* ───────────────────────────── Sections ───────────────────────────── */

export async function addSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    const s = await addSection(actor, courseId, str(data, "title"));
    refreshCourse(uni, courseId);
    return `Added ${s.title}.`;
  });
}

export async function renameSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const s = await renameSection(actor, str(data, "sectionId"), str(data, "title"));
    refreshCourse(uni, s.courseId);
    return "Section renamed.";
  });
}

export async function moveSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return quiet(async () => {
    await moveSection(actor, str(data, "sectionId"), direction(data));
    refreshCourse(uni, str(data, "courseId"));
  });
}

export async function deleteSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return quiet(async () => {
    await deleteSection(actor, str(data, "sectionId"));
    refreshCourse(uni, str(data, "courseId"));
  });
}

/* ───────────────────────────── Lessons ───────────────────────────── */

export async function addLessonAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  let created: { id: string; kind: string } | null = null;
  const result = await attempt(async () => {
    created = await addLesson(actor, courseId, str(data, "sectionId"), {
      title: str(data, "title"),
      kind: str(data, "kind") || "video",
      required: str(data, "required") !== "optional",
    });
    refreshCourse(uni, courseId);
    return "Lesson added.";
  });
  // Straight to the editor to add the video, PDF, text or link. Live lessons need nothing more.
  const l = created as { id: string; kind: string } | null;
  if (l && l.kind !== "live") redirect(lessonEditorPath(uni, l.id));
  return result;
}

export async function moveLessonAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return quiet(async () => {
    await moveLesson(actor, str(data, "lessonId"), direction(data));
    refreshCourse(uni, str(data, "courseId"));
  });
}

export async function deleteLessonAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let courseId = "";
  const result = await quiet(async () => {
    ({ courseId } = await deleteLesson(actor, str(data, "lessonId")));
    refreshCourse(uni, courseId);
  });
  if (!result?.error && str(data, "from") === "editor") redirect(curriculumPath(uni, courseId));
  return result;
}

function dripFrom(data: FormData): DripInput {
  const mode = str(data, "dripMode");
  if (mode === "after_start") return { mode, days: str(data, "dripDays") === "" ? NaN : Number(str(data, "dripDays")) };
  if (mode === "on_date") return { mode, date: str(data, "dripDate") };
  return { mode: "none" };
}

export async function updateLessonAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const duration = str(data, "durationMinutes");
    const l = await updateLesson(actor, str(data, "lessonId"), {
      title: str(data, "title"),
      sectionId: str(data, "sectionId") || undefined,
      required: str(data, "required") !== "optional",
      durationMinutes: duration === "" ? 0 : Number(duration),
      drip: dripFrom(data),
    });
    refreshCourse(uni, l.courseId);
    revalidatePath(lessonEditorPath(uni, l.id));
    return "Lesson settings saved.";
  });
}

export async function setLessonKindAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const l = await setLessonKind(actor, str(data, "lessonId"), str(data, "kind"));
    refreshCourse(uni, l.courseId);
    revalidatePath(lessonEditorPath(uni, l.id));
    return "Lesson type changed.";
  });
}

export async function saveTextAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const l = await setTextContent(actor, str(data, "lessonId"), String(data.get("html") ?? ""));
    refreshCourse(uni, l.courseId);
    revalidatePath(lessonEditorPath(uni, l.id));
    return "Text saved. Students see it now.";
  });
}

export async function saveLinkAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const l = await setLinkContent(actor, str(data, "lessonId"), str(data, "url"));
    refreshCourse(uni, l.courseId);
    revalidatePath(lessonEditorPath(uni, l.id));
    return "Link saved.";
  });
}

export async function saveVideoLinkAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const l = await setVideoLink(actor, str(data, "lessonId"), str(data, "url"));
    refreshCourse(uni, l.courseId);
    revalidatePath(lessonEditorPath(uni, l.id));
    return "Video link saved.";
  });
}

export async function clearContentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const l = await clearLessonContent(actor, str(data, "lessonId"));
    refreshCourse(uni, l.courseId);
    revalidatePath(lessonEditorPath(uni, l.id));
    return "Content removed. Students won't see this lesson until you add new content.";
  });
}

/* ───────────────────────────── Learner ───────────────────────────── */

export async function markLessonCompleteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const lessonId = str(data, "lessonId");
  return attempt(async () => {
    const r = await markLessonComplete(actor, lessonId);
    revalidatePath(lessonPath(uni, lessonId));
    revalidatePath(`/${uni}/learn`, "layout");
    if (r.courseCompleted) return "Lesson complete. You've finished every required lesson, so the course is complete.";
    return r.lessonCompleted ? "Lesson complete." : "You've already completed this lesson.";
  });
}

/** Remembers the lesson the learner is on ("continue learning", last activity). */
export async function recordLessonOpenedAction(uni: string, lessonId: string) {
  try {
    const { actor } = await spaceContext(uni);
    await recordLessonOpened(actor, lessonId);
  } catch (e) {
    unstable_rethrow(e);
    if (!(e instanceof AppError)) console.error(e);
  }
}

/* ───────────────────────────── Staff ───────────────────────────── */

export async function markStudentCompleteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  return attempt(async () => {
    const r = await markStudentComplete(actor, batchId, str(data, "enrolmentId"));
    revalidatePath(batchProgressPath(uni, batchId));
    return r.status === "completed" ? `${str(data, "name") || "The student"} is marked complete.` : "This student had already completed the course.";
  });
}
