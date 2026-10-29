import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, Select, Stat, Table, Td, Textarea } from "@/components/ui";
import type { Actor } from "@/server/core";
import {
  addToSeriesAction,
  deleteTestAction,
  moveInSeriesAction,
  publishAction,
  removeFromSeriesAction,
  updateProctoringAction,
  updateSettingsAction,
} from "../actions";
import { SHOW_ANSWERS, SHOW_ANSWERS_LABEL, SUBMIT_REASON_LABEL, TYPE_LABEL, fmtMarks, fmtPercent, plural } from "../lib/labels";
import { formatMoment, utcToZonedInput } from "../lib/time";
import { seriesTests, type getTest } from "../manage";
import { testResults } from "../results";
import type { QuestionType } from "../schema";
import { InlineAction, KindBadge, PercentBar, StatusBadge } from "./bits";
import { TargetsPicker } from "./targets";

type TestInfo = Awaited<ReturnType<typeof getTest>>;

function Toggle({ name, label, hint, defaultChecked, disabled }: { name: string; label: string; hint?: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-1 accent-brand" />
      <span className="text-[14px]">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/* ───────────────────────────── Proctoring ───────────────────────────── */

export function ProctoringTab({ uni, info }: { uni: string; info: TestInfo }) {
  const t = info.test;
  const ro = !info.canManage;
  return (
    <Card className="max-w-3xl">
      <CardTitle hint={`Times are in ${info.timezone.replace("_", " ")}`}>Proctoring</CardTitle>
      <ActionForm action={updateProctoringAction} className="space-y-5" resetOnSuccess={false}>
        <input type="hidden" name="uni" value={uni} />
        <input type="hidden" name="testId" value={t.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opens at" hint="Empty = open as soon as it's published.">
            <Input type="datetime-local" name="opensAt" defaultValue={utcToZonedInput(t.opensAt, info.timezone)} disabled={ro} />
          </Field>
          <Field label="Closes at" hint="Empty = stays open. Attempts end at this time.">
            <Input type="datetime-local" name="closesAt" defaultValue={utcToZonedInput(t.closesAt, info.timezone)} disabled={ro} />
          </Field>
          <Field label="Time limit (minutes)" hint="Empty = no time limit. The server ends the attempt.">
            <Input type="number" name="timeLimitMinutes" min={1} max={1440} defaultValue={t.timeLimitMinutes ?? ""} disabled={ro} />
          </Field>
          <Field label="Attempts allowed">
            <Input type="number" name="attemptLimit" min={1} max={50} defaultValue={t.attemptLimit} required disabled={ro} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle name="fullscreenRequired" label="Full screen required" hint="The test asks for full screen, and each exit is recorded." defaultChecked={t.fullscreenRequired} disabled={ro} />
          <div className="rounded-2xl border border-line bg-surface px-4 py-3">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="limitTabs" defaultChecked={t.tabSwitchLimit !== null} disabled={ro} className="mt-1 accent-brand" />
              <span className="text-[14px]">
                <span className="font-medium">Limit tab switches</span>
                <span className="block text-[13px] text-muted">Leaving the test more times than this submits it.</span>
              </span>
            </label>
            <div className="ml-7 mt-2 flex items-center gap-2 text-[13px]">
              Allowed
              <Input type="number" name="tabSwitchLimit" min={0} max={50} defaultValue={t.tabSwitchLimit ?? 3} className="h-8! w-20!" disabled={ro} aria-label="Tab switches allowed" />
              times
            </div>
          </div>
          <Toggle name="shuffleQuestions" label="Shuffle questions" hint="Each student gets their own order." defaultChecked={t.shuffleQuestions} disabled={ro} />
          <Toggle name="shuffleOptions" label="Shuffle options" hint="Choice options in a different order for each student." defaultChecked={t.shuffleOptions} disabled={ro} />
          <Toggle name="onePerPage" label="One question per page" hint="Students move with Next and Previous." defaultChecked={t.onePerPage} disabled={ro} />
        </div>
        {info.attemptCount > 0 && <Notice tone="gold">Students have started this test. Changes apply to attempts started from now on.</Notice>}
        {!ro && <SubmitButton>Save proctoring</SubmitButton>}
      </ActionForm>
    </Card>
  );
}

/* ───────────────────────────── Settings ───────────────────────────── */

export function SettingsTab({ uni, info, wholeCourse, pickable }: { uni: string; info: TestInfo; wholeCourse: boolean; pickable: { id: string; name: string; status: string }[] }) {
  const t = info.test;
  const ro = !info.canManage;
  const isSeries = t.kind === "series";
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardTitle>Settings</CardTitle>
        <ActionForm action={updateSettingsAction} className="space-y-5" resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="testId" value={t.id} />
          <Field label="Title">
            <Input name="title" defaultValue={t.title} required minLength={3} maxLength={160} disabled={ro} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select name="kind" defaultValue={t.kind} disabled={ro || isSeries}>
                {isSeries ? (
                  <option value="series">Test series</option>
                ) : (
                  <>
                    <option value="quiz">Quiz</option>
                    <option value="mock_test">Mock test</option>
                  </>
                )}
              </Select>
              {isSeries && <input type="hidden" name="kind" value="series" />}
            </Field>
            <Field label="Pass mark (%)">
              <Input name="passPercent" type="number" min={0} max={100} defaultValue={t.passPercent} required disabled={ro} />
            </Field>
          </div>
          <Field label="When answers are shown">
            <Select name="showAnswers" defaultValue={t.showAnswers} disabled={ro}>
              {SHOW_ANSWERS.map((s) => (
                <option key={s} value={s}>
                  {SHOW_ANSWERS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Instructions" hint="Shown to students before they start.">
            <Textarea name="instructions" defaultValue={t.instructions} rows={3} disabled={ro} />
          </Field>
          <TargetsPicker
            wholeCourse={wholeCourse || (t.allBatches && ro)}
            batches={ro ? info.courseBatches.filter((b) => info.batchIds.includes(b.id)) : pickable}
            allBatches={t.allBatches}
            selected={info.batchIds}
            disabled={ro}
          />
          {!ro && <SubmitButton>Save settings</SubmitButton>}
        </ActionForm>
      </Card>

      <div className="space-y-6">
        <Card className="h-fit">
          <CardTitle>Publish</CardTitle>
          {t.status === "published" ? (
            <>
              <p className="mb-4 text-[14px] text-muted">
                Published {t.publishedAt ? formatMoment(t.publishedAt, info.timezone) : ""}. Students in its batches can see it{t.seriesId ? " once the series is published" : ""}.
              </p>
              {!ro && (
                <ActionForm action={publishAction} resetOnSuccess={false}>
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="testId" value={t.id} />
                  <input type="hidden" name="publish" value="false" />
                  <SubmitButton variant="secondary">Move back to draft</SubmitButton>
                </ActionForm>
              )}
            </>
          ) : (
            <>
              <p className="mb-4 text-[14px] text-muted">Drafts are hidden from students. Publishing tells the students of its batches.</p>
              {!ro && (
                <ActionForm action={publishAction} resetOnSuccess={false}>
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="testId" value={t.id} />
                  <input type="hidden" name="publish" value="true" />
                  <SubmitButton>Publish {isSeries ? "series" : "test"}</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Card>
        {!ro && info.attemptCount === 0 && (
          <Card className="h-fit">
            <CardTitle>Delete</CardTitle>
            <p className="mb-4 text-[14px] text-muted">No student has started it, so it can be deleted. The questions stay in the pool.</p>
            <ActionForm action={deleteTestAction} resetOnSuccess={false} confirm={`Delete "${t.title}"? This can't be undone.`}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="testId" value={t.id} />
              <SubmitButton variant="danger">Delete {isSeries ? "series" : "test"}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Results ───────────────────────────── */

export async function ResultsTab({ uni, actor, testId, batchId, base }: { uni: string; actor: Actor; testId: string; batchId?: string; base: string }) {
  const r = await testResults(actor, testId, { batchId });
  const attemptHref = (id: string) => `/${uni}/admin/products/tests/attempts/${id}`;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Students" value={r.summary.students} hint={r.summary.inProgress ? `${r.summary.inProgress} taking it now` : undefined} />
        <Stat label="Average score" value={r.summary.average === null ? "–" : fmtPercent(r.summary.average)} hint="Graded attempts" />
        <Stat label="Pass rate" value={r.summary.passRate === null ? "–" : fmtPercent(r.summary.passRate)} hint={`Pass mark ${r.test.passPercent}%`} />
        <Stat label="To grade" value={r.summary.awaiting} hint={r.summary.awaiting ? "Short answers waiting" : "All graded"} />
      </div>

      {r.batches.length > 1 && (
        <form className="flex items-center gap-2" action={base}>
          <input type="hidden" name="tab" value="results" />
          <Select name="batch" defaultValue={batchId ?? ""} className="w-56!" aria-label="Batch">
            <option value="">All my batches</option>
            {r.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <button className="text-[14px] text-brand">Show</button>
        </form>
      )}

      {r.students.length === 0 ? (
        <Empty title="No attempts yet">Results show up here as students submit.</Empty>
      ) : (
        <Table head={["Student", "Batch", "Attempts", "Best score", "Result", ""]}>
          {r.students.map((s) => (
            <tr key={s.userId}>
              <Td>
                <div className="font-medium">{s.name}</div>
                <div className="text-[13px] text-muted">{s.email}</div>
              </Td>
              <Td className="text-muted">{s.batchName}</Td>
              <Td>
                <ul className="space-y-1 text-[13px]">
                  {s.attempts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <Link href={attemptHref(a.id)} className="text-brand hover:underline">
                        Attempt {a.attemptNo}
                      </Link>
                      {a.status === "in_progress" ? (
                        <Badge tone="gold">Taking now</Badge>
                      ) : a.status === "awaiting_grading" ? (
                        <Badge tone="gold">To grade</Badge>
                      ) : (
                        <span className="tabular">
                          {fmtMarks(a.score)}/{fmtMarks(a.maxScore)}
                        </span>
                      )}
                      {a.submitReason && a.submitReason !== "student" && <span className="text-muted">{SUBMIT_REASON_LABEL[a.submitReason]}</span>}
                      {a.tabSwitches > 0 && <span className="text-muted">left the test {plural(a.tabSwitches, "time")}</span>}
                    </li>
                  ))}
                </ul>
              </Td>
              <Td className="tabular">{s.best ? fmtPercent(s.best.scorePercent) : "–"}</Td>
              <Td>{s.best ? s.best.passed ? <Badge tone="brand">Passed</Badge> : <Badge tone="danger">Not passed</Badge> : <span className="text-muted">–</span>}</Td>
              <Td>
                {s.attempts.some((a) => a.status === "awaiting_grading" && a.canGrade) && (
                  <Link href={attemptHref(s.attempts.find((a) => a.status === "awaiting_grading")!.id)} className="text-[13px] font-medium text-brand">
                    Grade
                  </Link>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {r.questions.length > 0 && (
        <Card>
          <CardTitle hint="Across submitted attempts">Correct answers per question</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead className="text-left text-[13px] text-muted">
                <tr>
                  <th className="pb-2 font-normal">Question</th>
                  <th className="pb-2 font-normal">Seen by</th>
                  <th className="pb-2 font-normal">Answered</th>
                  <th className="pb-2 font-normal">Correct</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.questions.map((q) => (
                  <tr key={q.questionId ?? q.prompt}>
                    <td className="max-w-[420px] py-2.5 pr-4">
                      <div className="truncate">{q.prompt}</div>
                      <div className="text-[12px] text-muted">{TYPE_LABEL[q.type as QuestionType]}</div>
                    </td>
                    <td className="tabular py-2.5">{q.seen}</td>
                    <td className="tabular py-2.5">{q.answered}</td>
                    <td className="py-2.5">
                      {q.percentCorrect === null ? (
                        <span className="text-[13px] text-muted">
                          Average {fmtMarks(Math.round(q.avgScore * 100) / 100)} of {fmtMarks(q.marks)}
                          {q.waiting > 0 && `, ${q.waiting} to grade`}
                        </span>
                      ) : (
                        <PercentBar value={q.percentCorrect} tone={q.percentCorrect < 40 ? "gold" : "brand"} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────────── Series ───────────────────────────── */

export async function SeriesTab({ uni, actor, seriesId }: { uni: string; actor: Actor; seriesId: string }) {
  const s = await seriesTests(actor, seriesId);
  const fields = { uni, testId: seriesId };
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardTitle hint="Students see the series as one item, with its tests in this order">Tests in this series</CardTitle>
        {s.children.length === 0 ? (
          <Empty title="No tests yet">{s.canManage ? "Add tests of this course on the right." : "The series' owner hasn't added tests yet."}</Empty>
        ) : (
          <ol className="space-y-2">
            {s.children.map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4">
                <span className="tabular w-6 text-[13px] text-muted">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/${uni}/admin/products/tests/${c.id}`} className="font-medium hover:text-brand">
                    {c.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    <KindBadge kind={c.kind} />
                    <StatusBadge status={c.status} />
                    <span>{c.window}</span>
                    <span>{plural(c.attemptCount, "attempt")}</span>
                  </div>
                </div>
                {s.canManage && (
                  <div className="flex gap-1">
                    {i > 0 && (
                      <InlineAction action={moveInSeriesAction} fields={{ ...fields, childId: c.id, direction: "up" }}>
                        Move up
                      </InlineAction>
                    )}
                    {i < s.children.length - 1 && (
                      <InlineAction action={moveInSeriesAction} fields={{ ...fields, childId: c.id, direction: "down" }}>
                        Move down
                      </InlineAction>
                    )}
                    <InlineAction action={removeFromSeriesAction} fields={{ ...fields, childId: c.id }} variant="danger">
                      Remove
                    </InlineAction>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {s.canManage && (
        <Card className="h-fit">
          <CardTitle>Add a test</CardTitle>
          {s.candidates.length === 0 ? (
            <p className="text-[14px] text-muted">Every quiz and mock test of this course is already in a series. Create one from the tests list first.</p>
          ) : (
            <ActionForm action={addToSeriesAction} className="space-y-3">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="testId" value={seriesId} />
              <Select name="childId" aria-label="Test to add">
                {s.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.status === "draft" ? " (draft)" : ""}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary">Add to series</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
