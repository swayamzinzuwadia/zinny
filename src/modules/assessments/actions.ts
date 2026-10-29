"use server";

/**
 * Server actions for staff screens. Each one reads the form, calls one service, and
 * refreshes the pages that show what changed. Rules live in the services.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, num, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { poolKeyToDepartment } from "./access";
import type { QuestionDraft } from "./lib/marking";
import {
  addDrawRule,
  addQuestionsToTest,
  addToSeries,
  createTest,
  deleteTest,
  moveInSeries,
  moveQuestionInTest,
  removeDrawRule,
  removeFromSeries,
  removeQuestionFromTest,
  setPublished,
  updateProctoring,
  updateSettings,
} from "./manage";
import { archiveQuestion, createQuestion, importQuestions, updateQuestion } from "./pool";
import { gradeItem } from "./attempts";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

const base = (uni: string) => `/${uni}/admin/products/tests`;
const optNum = (d: FormData, k: string) => (str(d, k) === "" ? null : num(d, k));
const on = (d: FormData, k: string) => d.get(k) === "on" || d.get(k) === "true";

/* ───────────────────────────── Questions ───────────────────────────── */

function draftFrom(d: FormData): QuestionDraft {
  const type = str(d, "type");
  const options = d.getAll("option").map((o) => String(o));
  // The correct checkboxes/radio carry the option's row index; blank rows are dropped below, so remap.
  const filled = options.map((o, i) => ({ text: o.trim(), i })).filter((o) => o.text);
  const picked = new Set(d.getAll("correct").map((c) => Number(c)));
  return {
    type,
    prompt: str(d, "prompt"),
    options: filled.map((o) => o.text),
    correct: filled.flatMap((o, idx) => (picked.has(o.i) ? [idx] : [])),
    isTrue: str(d, "isTrue") === "" ? null : str(d, "isTrue") === "true",
    value: optNum(d, "value"),
    tolerance: optNum(d, "tolerance"),
    guide: str(d, "guide"),
    marks: optNum(d, "marks"),
    negativeMarks: optNum(d, "negativeMarks"),
    difficulty: str(d, "difficulty"),
    tags: str(d, "tags").split(","),
    explanation: str(d, "explanation"),
  };
}

export async function createQuestionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let saved = false;
  const res = await attempt(async () => {
    await createQuestion(actor, poolKeyToDepartment(str(data, "pool")), draftFrom(data));
    saved = true;
    return "Question added to the pool.";
  });
  if (saved) {
    revalidatePath(`${base(uni)}/pool`);
    if (str(data, "then") === "pool") redirect(`${base(uni)}/pool?pool=${encodeURIComponent(str(data, "pool"))}`);
  }
  return res;
}

export async function updateQuestionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let saved = false;
  const res = await attempt(async () => {
    await updateQuestion(actor, str(data, "questionId"), draftFrom(data));
    saved = true;
    return "Question saved.";
  });
  if (saved) {
    revalidatePath(`${base(uni)}/pool`);
    redirect(`${base(uni)}/pool${str(data, "back") ? `?${str(data, "back")}` : ""}`);
  }
  return res;
}

export async function archiveQuestionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await archiveQuestion(actor, str(data, "questionId"));
    revalidatePath(`${base(uni)}/pool`);
    return "Question removed from the pool.";
  });
}

export type ImportState = (NonNullable<ActionState> & { result?: Awaited<ReturnType<typeof importQuestions>>; csv?: string }) | null;

export async function importQuestionsAction(_: ImportState, data: FormData): Promise<ImportState> {
  const { uni, actor } = await ctx(data);
  const file = data.get("file");
  const csv = file instanceof File && file.size > 0 ? await file.text() : String(data.get("csv") ?? "");
  const commit = str(data, "mode") === "commit";
  let result: Awaited<ReturnType<typeof importQuestions>> | undefined;
  const res = await attempt(async () => {
    result = await importQuestions(actor, poolKeyToDepartment(str(data, "pool")), csv, { commit });
    revalidatePath(`${base(uni)}/pool`);
    if (result.errors > 0) throw new ValidationError(`${result.errors} row${result.errors === 1 ? "" : "s"} need fixing. Nothing was imported.`);
    const skipped = result.skipped ? ` ${result.skipped} already in the pool will be skipped.` : "";
    if (!commit) return `All ${result.total} rows look good.${skipped} Import them when ready.`;
    return result.saved ? `Imported ${result.saved} question${result.saved === 1 ? "" : "s"}.${result.skipped ? ` Skipped ${result.skipped} already in the pool.` : ""}` : "Every question is already in the pool. Nothing new to import.";
  });
  return { ...res, result, csv };
}

/* ───────────────────────────── Tests ───────────────────────────── */

function targets(d: FormData) {
  const scope = str(d, "scope");
  return { allBatches: scope !== "batches", batchIds: d.getAll("batchId").map(String).filter(Boolean) };
}

export async function createTestAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let id: string | null = null;
  const res = await attempt(async () => {
    const t = await createTest(actor, { kind: str(data, "kind"), title: str(data, "title"), courseId: str(data, "courseId"), ...targets(data) });
    id = t.id;
  });
  if (id) {
    revalidatePath(base(uni));
    redirect(`${base(uni)}/${id}`);
  }
  return res;
}

export async function updateSettingsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    await updateSettings(actor, testId, {
      title: str(data, "title"),
      kind: str(data, "kind"),
      instructions: String(data.get("instructions") ?? ""),
      passPercent: num(data, "passPercent"),
      showAnswers: str(data, "showAnswers"),
      ...targets(data),
    });
    revalidatePath(`${base(uni)}/${testId}`);
    return "Settings saved.";
  });
}

export async function updateProctoringAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    await updateProctoring(actor, testId, {
      timeLimitMinutes: optNum(data, "timeLimitMinutes"),
      fullscreenRequired: on(data, "fullscreenRequired"),
      tabSwitchLimit: on(data, "limitTabs") ? optNum(data, "tabSwitchLimit") : null,
      shuffleQuestions: on(data, "shuffleQuestions"),
      shuffleOptions: on(data, "shuffleOptions"),
      onePerPage: on(data, "onePerPage"),
      attemptLimit: num(data, "attemptLimit"),
      opensAt: str(data, "opensAt"),
      closesAt: str(data, "closesAt"),
    });
    revalidatePath(`${base(uni)}/${testId}`);
    return "Proctoring saved.";
  });
}

export async function publishAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  const publish = str(data, "publish") === "true";
  return attempt(async () => {
    await setPublished(actor, testId, publish);
    revalidatePath(`${base(uni)}/${testId}`);
    revalidatePath(base(uni));
    return publish ? "Published. Students in its batches can see it now." : "Moved back to draft. Students can't see it.";
  });
}

export async function deleteTestAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  let done = false;
  const res = await attempt(async () => {
    await deleteTest(actor, str(data, "testId"));
    done = true;
  });
  if (done) {
    revalidatePath(base(uni));
    redirect(base(uni));
  }
  return res;
}

export async function addQuestionsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    const r = await addQuestionsToTest(actor, testId, data.getAll("questionId").map(String));
    revalidatePath(`${base(uni)}/${testId}`);
    return r.skipped ? `Added ${r.added}. ${r.skipped} ${r.skipped === 1 ? "was" : "were"} already in the test.` : `Added ${r.added} question${r.added === 1 ? "" : "s"}.`;
  });
}

export async function removeQuestionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    await removeQuestionFromTest(actor, testId, str(data, "questionId"));
    revalidatePath(`${base(uni)}/${testId}`);
    return "Question removed from the test.";
  });
}

export async function moveQuestionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    await moveQuestionInTest(actor, testId, str(data, "questionId"), str(data, "direction") === "up" ? "up" : "down");
    revalidatePath(`${base(uni)}/${testId}`);
    return "Moved.";
  });
}

export async function addDrawRuleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    await addDrawRule(actor, testId, { count: num(data, "count"), pool: str(data, "pool"), difficulty: str(data, "difficulty"), type: str(data, "type"), tag: str(data, "tag") });
    revalidatePath(`${base(uni)}/${testId}`);
    return "Draw rule added. Each student gets their own random questions.";
  });
}

export async function removeDrawRuleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const testId = str(data, "testId");
  return attempt(async () => {
    await removeDrawRule(actor, testId, str(data, "ruleId"));
    revalidatePath(`${base(uni)}/${testId}`);
    return "Draw rule removed.";
  });
}

/* ───────────────────────────── Series ───────────────────────────── */

export async function addToSeriesAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const seriesId = str(data, "testId");
  return attempt(async () => {
    await addToSeries(actor, seriesId, str(data, "childId"));
    revalidatePath(`${base(uni)}/${seriesId}`);
    return "Added to the series.";
  });
}

export async function removeFromSeriesAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const seriesId = str(data, "testId");
  return attempt(async () => {
    await removeFromSeries(actor, seriesId, str(data, "childId"));
    revalidatePath(`${base(uni)}/${seriesId}`);
    return "Removed from the series.";
  });
}

export async function moveInSeriesAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const seriesId = str(data, "testId");
  return attempt(async () => {
    await moveInSeries(actor, seriesId, str(data, "childId"), str(data, "direction") === "up" ? "up" : "down");
    revalidatePath(`${base(uni)}/${seriesId}`);
    return "Moved.";
  });
}

/* ───────────────────────────── Grading ───────────────────────────── */

export async function gradeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const r = await gradeItem(actor, str(data, "itemId"), { score: num(data, "score"), feedback: str(data, "feedback") });
    revalidatePath(`${base(uni)}/attempts/${str(data, "attemptId")}`);
    revalidatePath(`${base(uni)}/grading`);
    return r.status === "graded" ? "Graded. The student's result is ready." : `Saved. ${r.left} answer${r.left === 1 ? "" : "s"} left to grade in this attempt.`;
  });
}
