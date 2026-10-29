import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Input, Notice, PageHeader, Stat, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { gradeAction } from "@/modules/assessments/actions";
import { KindBadge } from "@/modules/assessments/components/bits";
import { SUBMIT_REASON_LABEL, TYPE_LABEL, fmtMarks, fmtPercent, plural } from "@/modules/assessments/lib/labels";
import { formatMoment } from "@/modules/assessments/lib/time";
import { staffAttempt } from "@/modules/assessments/results";

export const metadata = { title: "Attempt" };

function responseText(i: { type: string; options: { id: string; text: string }[]; response: unknown }) {
  const r = i.response as { option?: string; options?: string[]; value?: number; text?: string } | null;
  if (!r) return null;
  if (r.option) return i.options.find((o) => o.id === r.option)?.text ?? "";
  if (r.options) return r.options.map((id) => i.options.find((o) => o.id === id)?.text ?? "").join(", ");
  if (r.value !== undefined) return String(r.value);
  return r.text ?? null;
}

export default async function StaffAttemptPage({ params }: { params: Promise<{ uni: string; attemptId: string }> }) {
  const { uni, attemptId } = await params;
  const { actor } = await spaceContext(uni);
  const d = await staffAttempt(actor, attemptId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const a = d.attempt;
  const waiting = d.items.filter((i) => i.needsGrading).length;
  const tz = d.timezone;

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/tests`} className="hover:text-ink">
          Tests
        </Link>{" "}
        /{" "}
        <Link href={`/${uni}/admin/products/tests/${d.test.id}?tab=results`} className="hover:text-ink">
          {d.test.title}
        </Link>
      </div>
      <PageHeader
        title={d.student.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <KindBadge kind={d.test.kind} />
            <span>
              {d.batchName} · Attempt {a.attemptNo} · Started {formatMoment(a.startedAt, tz)}
              {a.submittedAt && ` · Submitted ${formatMoment(a.submittedAt, tz)}`}
            </span>
          </span>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Score"
          value={a.status === "graded" ? fmtPercent(a.scorePercent) : a.status === "in_progress" ? "–" : "Pending"}
          hint={a.status === "graded" ? `${fmtMarks(a.score)} of ${fmtMarks(a.maxScore)} marks` : a.status === "awaiting_grading" ? `${fmtMarks(a.score)} marks so far, before grading` : "Still taking the test"}
        />
        <Stat label="Result" value={a.status === "graded" ? (a.passed ? "Passed" : "Not passed") : "–"} hint={`Pass mark ${d.test.passPercent}%`} />
        <Stat label="Left the test" value={a.tabSwitches} hint={d.test.tabSwitchLimit !== null ? `Limit ${d.test.tabSwitchLimit}` : "No limit"} />
        <Stat label="Full screen exits" value={a.fullscreenExits} hint={a.submitReason ? SUBMIT_REASON_LABEL[a.submitReason] : "In progress"} />
      </div>
      {waiting > 0 && (
        <div className="mb-6">
          <Notice tone="gold">
            {plural(waiting, "short answer")} to grade. The student gets the result once every answer is graded.
            {!d.canGrade && " Only the faculty of this student's batch, the HOD or an admin can grade it."}
          </Notice>
        </div>
      )}
      {a.status === "in_progress" && (
        <div className="mb-6">
          <Notice tone="neutral">The student is taking this test now. Answers saved so far are shown, unmarked.</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <ol className="space-y-3">
          {d.items.map((i) => {
            const given = responseText(i);
            const correct = new Set(i.correctOptionIds ?? []);
            return (
              <li key={i.id}>
                <Card className={cx("p-5", i.needsGrading && "border-gold ring-2 ring-gold-soft")}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className="tabular text-muted">{i.position + 1}.</span>
                      <Badge>{TYPE_LABEL[i.type]}</Badge>
                    </span>
                    {i.needsGrading ? (
                      <Badge tone="gold">To grade</Badge>
                    ) : i.awarded === null ? null : (
                      <span className="flex items-center gap-2">
                        {i.gradedAt && <Badge tone="brand">Graded</Badge>}
                        <span className={cx("tabular font-medium", i.awarded > 0 ? "text-brand" : i.awarded < 0 ? "text-danger" : "text-muted")}>
                          {i.awarded > 0 ? "+" : ""}
                          {fmtMarks(i.awarded)} / {fmtMarks(i.marks)}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-[14px] font-medium">{i.prompt}</p>
                  {i.options.length > 0 && (
                    <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
                      {i.options.map((o, k) => {
                        const picked = given !== null && ((i.response as { option?: string })?.option === o.id || ((i.response as { options?: string[] })?.options ?? []).includes(o.id));
                        return (
                          <li key={o.id} className={cx("flex gap-2 rounded-xl px-2.5 py-1.5", correct.has(o.id) ? "bg-brand-soft text-brand-strong" : picked ? "bg-danger-soft text-danger" : "bg-canvas")}>
                            <span className="text-muted">{String.fromCharCode(65 + k)}</span>
                            <span className="flex-1">{o.text}</span>
                            {picked && <span className="font-medium">Picked</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {i.options.length === 0 && (
                    <div className="mt-2 rounded-xl bg-canvas px-3 py-2 text-[14px]">
                      <span className="text-[12px] text-muted">Answer: </span>
                      {given === null ? <span className="text-muted">Not answered</span> : <span className="whitespace-pre-wrap">{given}</span>}
                    </div>
                  )}
                  {i.correctValue && (
                    <p className="mt-2 text-[13px] text-brand-strong">
                      Correct: {i.correctValue.value}
                      {i.correctValue.tolerance > 0 && ` (±${i.correctValue.tolerance})`}
                    </p>
                  )}
                  {i.guide && <p className="mt-2 text-[13px] text-muted">Guide: {i.guide}</p>}
                  {i.feedback && !i.needsGrading && <p className="mt-2 text-[13px] text-muted">Feedback: {i.feedback}</p>}
                  {i.needsGrading && d.canGrade && (
                    <ActionForm action={gradeAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[140px_1fr_auto] sm:items-end" resetOnSuccess={false}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="itemId" value={i.id} />
                      <input type="hidden" name="attemptId" value={a.id} />
                      <label className="block text-[13px] font-medium">
                        Marks (of {fmtMarks(i.marks)})
                        <Input name="score" type="number" step="0.25" min={0} max={i.marks} required className="mt-1.5" />
                      </label>
                      <label className="block text-[13px] font-medium">
                        Feedback for the student
                        <Textarea name="feedback" rows={1} className="mt-1.5 min-h-10" placeholder="Optional" />
                      </label>
                      <SubmitButton size="md">Save marks</SubmitButton>
                    </ActionForm>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
        <Card className="h-fit p-5">
          <CardTitle>Proctoring log</CardTitle>
          {d.events.length === 0 ? (
            <p className="text-[13px] text-muted">No tab switches or full-screen exits.</p>
          ) : (
            <ul className="space-y-1.5 text-[13px]">
              {d.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>{e.kind === "tab_hidden" ? "Left the test" : "Left full screen"}</span>
                  <span className="tabular text-muted">{formatMoment(e.at, tz).split(", ")[1]}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
