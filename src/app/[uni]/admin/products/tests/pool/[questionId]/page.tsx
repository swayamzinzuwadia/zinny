import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { updateQuestionAction } from "@/modules/assessments/actions";
import { QuestionPreview } from "@/modules/assessments/components/bits";
import { QuestionForm, type QuestionFormValues } from "@/modules/assessments/components/question-form";
import { correctOptionIds } from "@/modules/assessments/lib/marking";
import { getQuestion } from "@/modules/assessments/pool";

export const metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params, searchParams }: { params: Promise<{ uni: string; questionId: string }>; searchParams: Promise<{ back?: string }> }) {
  const { uni, questionId } = await params;
  const { back } = await searchParams;
  const { actor } = await spaceContext(uni);
  const { question: q, canEdit } = await getQuestion(actor, questionId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const correct = new Set(correctOptionIds(q.answer));
  const initial: QuestionFormValues = {
    type: q.type,
    prompt: q.prompt,
    options: q.type === "true_false" ? [] : q.options.map((o) => ({ text: o.text, correct: correct.has(o.id) })),
    isTrue: q.type === "true_false" ? correct.has("t") : null,
    value: "value" in q.answer ? q.answer.value : null,
    tolerance: "tolerance" in q.answer ? q.answer.tolerance : 0,
    guide: "guide" in q.answer ? q.answer.guide : "",
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    difficulty: q.difficulty,
    tags: q.tags,
    explanation: q.explanation,
  };
  const poolHref = `/${uni}/admin/products/tests/pool${back ? `?${back}` : ""}`;
  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/tests`} className="hover:text-ink">
          Tests
        </Link>{" "}
        /{" "}
        <Link href={poolHref} className="hover:text-ink">
          Question pool
        </Link>
      </div>
      <PageHeader title={canEdit ? "Edit question" : "Question"} subtitle="Changes apply to tests from now on. Attempts already taken keep the version the student saw." />
      <Card className="max-w-3xl">
        {canEdit ? (
          <QuestionForm action={updateQuestionAction} hidden={{ uni, questionId: q.id, back: back ?? "" }} initial={initial} submitLabel="Save question" />
        ) : (
          <div className="space-y-4">
            <Notice tone="neutral">Only the person who wrote this question, the HOD or an admin can change it.</Notice>
            <QuestionPreview q={q} />
          </div>
        )}
      </Card>
    </>
  );
}
