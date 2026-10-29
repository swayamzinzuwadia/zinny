import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, Notice, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { ConflictError, NotFoundError } from "@/server/errors";
import { attemptResult, type ReviewItem } from "@/modules/assessments/attempts";
import { StartTest } from "@/modules/assessments/components/start-button";
import { SUBMIT_REASON_LABEL, fmtMarks, fmtPercent } from "@/modules/assessments/lib/labels";
import { formatMoment } from "@/modules/assessments/lib/time";
import { timezoneOf } from "@/modules/assessments/results";

export const metadata = { title: "Result" };
export const dynamic = "force-dynamic";

function given(i: ReviewItem) {
  const r = i.response as { option?: string; options?: string[]; value?: number; text?: string } | null;
  if (!r) return null;
  if (r.value !== undefined) return String(r.value);
  if (r.text !== undefined) return r.text;
  return null;
}

/** The student's result. Answers appear only when the test's "when answers are shown" allows it. */
export default async function ResultPage({ params }: { params: Promise<{ uni: string; attemptId: string }> }) {
  const { uni, attemptId } = await params;
  const { actor } = await spaceContext(uni);
  const [r, timezone] = await Promise.all([
    attemptResult(actor, attemptId).catch((e) => {
      if (e instanceof NotFoundError) notFound();
      if (e instanceof ConflictError) redirect(`/${uni}/learn/tests/attempt/${attemptId}`);
      throw e;
    }),
    timezoneOf(actor),
  ]);
  const a = r.attempt;
  const graded = a.status === "graded";

  return (
    <>
      <Link href={`/${uni}/learn/tests/${r.test.id}`} className="text-sm text-muted">
        {r.test.title}
      </Link>
      <section className={cx("mt-3 rounded-[var(--radius-board)] p-6 sm:p-8", graded ? "bg-brand-deep text-canvas" : "bg-gold-soft")}>
        <div className={cx("text-[13px]", graded ? "text-canvas/70" : "text-gold-strong")}>
          Attempt {a.attemptNo}
          {a.submittedAt && ` · ${formatMoment(new Date(a.submittedAt), timezone)}`}
          {a.submitReason && a.submitReason !== "student" && ` · ${SUBMIT_REASON_LABEL[a.submitReason]}`}
        </div>
        {graded ? (
          <>
            <div className="tabular mt-2 text-[56px] font-semibold leading-none">{fmtPercent(a.scorePercent)}</div>
            <div className="mt-2 text-[15px] text-canvas/80">
              {fmtMarks(a.score)} of {fmtMarks(a.maxScore)} marks · {a.passed ? `Passed (pass mark ${r.test.passPercent}%)` : `Pass mark is ${r.test.passPercent}%`}
            </div>
          </>
        ) : (
          <>
            <div className="mt-2 text-[24px] font-semibold text-ink">Submitted. Your result is being graded.</div>
            <div className="mt-1 text-[14px] text-muted">Some answers are marked by your teacher. You&apos;ll get a notification when the result is ready.</div>
          </>
        )}
      </section>

      <div className="mt-5 space-y-4">
        {r.canRetake && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <span className="text-[14px]">
              You have {r.test.attemptLimit - r.attemptsUsed} attempt{r.test.attemptLimit - r.attemptsUsed === 1 ? "" : "s"} left.
            </span>
            <StartTest uni={uni} testId={r.test.id} label="Try again" fullscreen={false} />
          </Card>
        )}

        {r.answersHidden === "never" && <Notice tone="neutral">Answers for this test aren&apos;t shared.</Notice>}
        {r.answersHidden === "until_close" && r.test.closesAt && (
          <Notice tone="neutral">Answers will be shown after the test closes on {formatMoment(new Date(r.test.closesAt), timezone)}.</Notice>
        )}

        {r.items && (
          <section>
            <h2 className="mb-3 text-[17px] font-medium">Your answers</h2>
            <ol className="space-y-3">
              {r.items.map((i) => {
                const correct = new Set(i.correctOptionIds ?? []);
                const mine = new Set(((i.response as { options?: string[] })?.options ?? []).concat((i.response as { option?: string })?.option ?? []));
                const text = given(i);
                return (
                  <li key={i.id} className="rounded-[22px] border border-line bg-surface p-4 sm:p-5">
                    <div className="mb-2 flex items-center justify-between gap-3 text-[12px] text-muted">
                      <span>Question {i.position + 1}</span>
                      {i.needsGrading ? (
                        <Badge tone="gold">Being graded</Badge>
                      ) : i.correct === true ? (
                        <Badge tone="brand">Right, +{fmtMarks(i.awarded)}</Badge>
                      ) : i.correct === false && i.type !== "short" ? (
                        <Badge tone="danger">{i.awarded && i.awarded < 0 ? `Wrong, ${fmtMarks(i.awarded)}` : "Wrong"}</Badge>
                      ) : i.type === "short" && i.awarded !== null && i.response ? (
                        <Badge tone="neutral">
                          {fmtMarks(i.awarded)} of {fmtMarks(i.marks)}
                        </Badge>
                      ) : (
                        <Badge>Not answered</Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] font-medium">{i.prompt}</p>
                    {i.options.length > 0 && (
                      <ul className="mt-3 space-y-1.5 text-[14px]">
                        {i.options.map((o) => (
                          <li
                            key={o.id}
                            className={cx(
                              "flex items-center justify-between gap-2 rounded-xl px-3 py-2",
                              correct.has(o.id) ? "bg-brand-soft text-brand-strong" : mine.has(o.id) ? "bg-danger-soft text-danger" : "bg-canvas",
                            )}
                          >
                            <span>{o.text}</span>
                            <span className="shrink-0 text-[12px] font-medium">
                              {mine.has(o.id) && "Your answer"}
                              {mine.has(o.id) && correct.has(o.id) && " · "}
                              {correct.has(o.id) && "Correct"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {i.options.length === 0 && (
                      <div className="mt-3 rounded-xl bg-canvas px-3 py-2 text-[14px]">
                        <span className="text-[12px] text-muted">Your answer: </span>
                        {text === null ? <span className="text-muted">Not answered</span> : <span className="whitespace-pre-wrap">{text}</span>}
                      </div>
                    )}
                    {i.correctValue && (
                      <p className="mt-2 text-[14px] text-brand-strong">
                        Correct answer: {i.correctValue.value}
                        {i.correctValue.tolerance > 0 && ` (±${i.correctValue.tolerance})`}
                      </p>
                    )}
                    {i.guide && <p className="mt-2 text-[13px] text-muted">Model answer: {i.guide}</p>}
                    {i.feedback && <p className="mt-2 text-[14px]">Feedback: {i.feedback}</p>}
                    {i.explanation && <p className="mt-2 text-[13px] text-muted">{i.explanation}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        )}
        <Link href={`/${uni}/learn/tests`} className="inline-block text-[14px] text-brand">
          Back to tests
        </Link>
      </div>
    </>
  );
}
