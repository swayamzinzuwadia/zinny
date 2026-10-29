/**
 * What assessments puts into core pages (contracts.md section 3). Server components.
 */
import Link from "next/link";
import { Badge, Card, CardTitle, Empty, buttonClass } from "@/components/ui";
import type { BatchSectionProps, CourseTabProps, DashboardCardProps, HomeCardProps, HubSectionProps, LearnerCourseTabProps } from "@/contracts/module";
import { gradingQueue } from "../attempts";
import { myResults, myTests } from "../learner";
import { KIND_LABEL, fmtPercent, plural } from "../lib/labels";
import { formatMoment } from "../lib/time";
import { listTests, testCourseChoices } from "../manage";
import { toGradeSummary } from "../results";
import { KindBadge, StatusBadge } from "./bits";
import { SeriesCard, TestCard, whenLine } from "./learner-cards";

const admin = (uni: string) => `/${uni}/admin/products/tests`;

/* ───────────────────────────── adminCourseTabs.tests ───────────────────────────── */

export async function CourseTestsTab({ uni, actor, course }: CourseTabProps) {
  const [tests, choices] = await Promise.all([listTests(actor, { courseId: course.id }), testCourseChoices(actor)]);
  const canCreate = choices.some((c) => c.courseId === course.id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">Quizzes, mock tests and test series for {course.title}.</p>
        <div className="flex gap-2">
          <Link href={`${admin(uni)}/pool`} className={buttonClass("secondary", "sm")}>
            Question pool
          </Link>
          {canCreate && (
            <Link href={`${admin(uni)}?course=${course.id}`} className={buttonClass("primary", "sm")}>
              New test
            </Link>
          )}
        </div>
      </div>
      {tests.length === 0 ? (
        <Empty title="No tests for this course yet">{canCreate ? "Create one from Tests, then pick questions from the pool." : "Tests for your batches will show here."}</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {tests.map((t) => (
            <Link key={t.id} href={`${admin(uni)}/${t.id}`}>
              <Card className="h-full p-5 hover:border-brand/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{t.title}</div>
                  <StatusBadge status={t.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  <KindBadge kind={t.kind} />
                  <span>{t.allBatches ? "Every batch" : t.batchNames.join(", ")}</span>
                </div>
                <div className="mt-2 text-[13px] text-muted">
                  {t.kind === "series" ? plural(t.childCount, "test") : `${plural(t.questionCount, "question")} · ${plural(t.attemptCount, "attempt")} · ${t.window}`}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── adminBatchSections.tests ───────────────────────────── */

export async function BatchTestsSection({ uni, actor, batch, course }: BatchSectionProps) {
  const tests = (await listTests(actor, { courseId: course.id })).filter((t) => t.kind !== "series" && (t.allBatches || t.batchNames.includes(batch.name)));
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold">Tests</h2>
        <Link href={`${admin(uni)}?course=${course.id}`} className="text-[13px] text-brand">
          All tests
        </Link>
      </div>
      {tests.length === 0 ? (
        <Empty title="No tests for this batch yet" />
      ) : (
        <ul className="divide-y divide-line rounded-[22px] border border-line bg-surface">
          {tests.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <Link href={`${admin(uni)}/${t.id}?tab=results&batch=${batch.id}`} className="font-medium hover:text-brand">
                  {t.title}
                </Link>
                <div className="text-[13px] text-muted">
                  {KIND_LABEL[t.kind]} · {t.window}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={t.status} />
                <Link href={`${admin(uni)}/${t.id}?tab=results&batch=${batch.id}`} className="text-[13px] text-brand">
                  Results
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────────── learnerCourseTabs.tests ───────────────────────────── */

export async function LearnerCourseTestsTab({ uni, actor, enrolment }: LearnerCourseTabProps) {
  if (enrolment.status !== "active") {
    // A finished course: its results stay, there's nothing left to take.
    const { rows, timezone } = await myResults(actor, 50, { courseId: enrolment.courseId });
    return rows.length === 0 ? <Empty title="No test results for this course" /> : <ResultsList uni={uni} rows={rows} timezone={timezone} />;
  }
  const { tests, series, timezone } = await myTests(actor, { courseId: enrolment.courseId, batchId: enrolment.batchId });
  if (tests.length + series.length === 0) return <Empty title="No tests yet">Tests and quizzes for your batch will show up here.</Empty>;
  const order = { available: 0, upcoming: 1, completed: 2 } as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {series.map((s) => (
        <SeriesCard key={s.id} s={s} uni={uni} timezone={timezone} />
      ))}
      {[...tests]
        .sort((a, b) => order[a.bucket] - order[b.bucket])
        .map((t) => (
          <TestCard key={t.id} t={t} uni={uni} timezone={timezone} compact />
        ))}
    </div>
  );
}

/* ───────────────────────────── learnerHubSections.test-results ───────────────────────────── */

type ResultRow = Awaited<ReturnType<typeof myResults>>["rows"][number];

function ResultsList({ uni, rows, timezone }: { uni: string; rows: ResultRow[]; timezone: string }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.attemptId}>
          <Link href={`/${uni}/learn/tests/attempt/${r.attemptId}/result`} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{r.testTitle}</div>
              <div className="truncate text-[13px] text-muted">
                {r.courseTitle}
                {r.submittedAt && ` · ${formatMoment(r.submittedAt, timezone)}`}
              </div>
            </div>
            {r.status === "awaiting_grading" ? <Badge tone="gold">Being graded</Badge> : <Badge tone={r.passed ? "brand" : "danger"}>{fmtPercent(r.scorePercent)}</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export async function TestResultsHub({ uni, actor }: HubSectionProps) {
  const { rows, timezone } = await myResults(actor, 8);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardTitle hint={<Link href={`/${uni}/learn/tests`}>All tests</Link>}>Test results</CardTitle>
      <ResultsList uni={uni} rows={rows} timezone={timezone} />
    </Card>
  );
}

/* ───────────────────────────── learnerHomeCards.upcoming-tests ───────────────────────────── */

export async function UpcomingTestsCard({ uni, actor }: HomeCardProps) {
  const { tests, series, timezone } = await myTests(actor);
  const all = [...tests, ...series.flatMap((s) => s.tests)];
  const now = all.filter((t) => t.bucket === "available").sort((a, b) => (a.closesAt?.getTime() ?? Infinity) - (b.closesAt?.getTime() ?? Infinity));
  const soon = all.filter((t) => t.bucket === "upcoming").sort((a, b) => (a.opensAt?.getTime() ?? 0) - (b.opensAt?.getTime() ?? 0));
  const shown = [...now, ...soon].slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <Card>
      <CardTitle hint={<Link href={`/${uni}/learn/tests`}>All tests</Link>}>Tests</CardTitle>
      <ul className="space-y-3">
        {shown.map((t) => (
          <li key={t.id}>
            <Link href={t.inProgress ? `/${uni}/learn/tests/attempt/${t.inProgress.id}` : `/${uni}/learn/tests/${t.id}`} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{t.title}</div>
                <div className="truncate text-[13px] text-muted">
                  {t.courseTitle} · {whenLine(t, timezone)}
                </div>
              </div>
              {t.inProgress ? (
                <Badge tone="gold">Resume</Badge>
              ) : t.bucket === "available" ? (
                <span className="shrink-0 text-[13px] font-medium text-brand">Start</span>
              ) : (
                <Badge>Soon</Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────────────────────────── dashboardCards.to-grade-tests ───────────────────────────── */

export async function ToGradeCard({ uni, actor }: DashboardCardProps) {
  const [summary, queue] = await Promise.all([toGradeSummary(actor), gradingQueue(actor)]);
  return (
    <Card>
      <CardTitle hint={summary.total ? <Link href={`${admin(uni)}/grading`}>Open grading</Link> : undefined}>Tests to grade</CardTitle>
      {summary.total === 0 ? (
        <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">No short answers waiting.</p>
      ) : (
        <ul className="space-y-2">
          {summary.tests.slice(0, 5).map((t) => {
            const first = queue.find((q) => q.testId === t.testId);
            return (
              <li key={t.testId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-soft p-4">
                <div className="text-[14px]">
                  <div className="font-medium text-ink">{t.title}</div>
                  <div className="text-gold-strong">
                    {t.courseTitle} · {plural(t.attempts, "attempt")}, {plural(t.answers, "answer")}
                  </div>
                </div>
                {first && (
                  <Link href={`${admin(uni)}/attempts/${first.attemptId}`} className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-canvas">
                    Grade
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
