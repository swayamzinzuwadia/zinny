"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { addLesson, addSection } from "./service";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

export async function addSectionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    await addSection(actor, courseId, str(data, "title"));
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    return "Section added.";
  });
}

export async function addLessonAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const courseId = str(data, "courseId");
  return attempt(async () => {
    await addLesson(actor, courseId, str(data, "sectionId"), { title: str(data, "title"), kind: str(data, "kind") || "video" });
    revalidatePath(`/${uni}/admin/products/courses/${courseId}`);
    return "Lesson added.";
  });
}
