import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Notice, buttonClass } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { whenLine } from "@/modules/assessments/components/learner-cards";
import { StartTest } from "@/modules/assessments/components/start-button";
import { KIND_LABEL, SHOW_ANSWERS_LABEL, fmtPercent, plural } from "@/modules/assessments/lib/labels";
import { formatMinutes, formatMoment } from "@/modules/assessments/lib/time";
import { myTest } from "@/modules/assessments/learner";

export const metadata = { title: "Test" };

/** Before starting: what the test is, its rules, and past attempts. */
export default async function LearnerTest({ params }: { params: Promise<{ uni: string; testId: string }> }) {
  const { uni, testId } = await params;
  const { actor } = await spaceContext(uni);
  const { test: t, row, series, timezone } = await myTest(actor, testId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const left = t.attemptLimit - t.attempts.length;
  const rules = [
    plural(t.questionCount, "question"),
    t.timeLimitMinutes ? `${formatMinutes(t.timeLimitMinutes)} once you start. The timer keeps running if you leave.` : "No time limit",
    row.closesAt ? `Must be submitted by ${formatMoment(row.closesAt, timezone)}` : null,
    t.attemptLimit === 1 ? "One attempt" : `${t.attemptLimit} attempts allowed, ${left} left`,
    `Pass mark ${t.passPercent}%`,
    row.fullscreenRequired ? "Runs in full screen. Leaving full screen is recorded." : null,
    row.tabSwitchLimit !== null
      ? row.tabSwitchLimit === 0
        ? "Leaving the test (switching tab or app) submits it straight away."
        : `You may leave the test (switch tab or app) ${plural(row.tabSwitchLimit, "time")}. One more submits it.`
      : null,
    `Answers are shown: ${SHOW_ANSWERS_LABEL[row.showAnswers].toLowerCase()}.`,
  ].filter(Boolean) as string[];

  return (
    <>
      <Link href={series ? `/${uni}/learn/tests/series/${series.id}` : `/${uni}/learn/tests`} className="text-sm text-muted">
        {series ? series.title : "Tests"}
      </Link>
      <div className="mb-5 mt-2">
        <div className="text-[13px] text-muted">
          {KIND_LABEL[t.kind]} · {t.courseTitle}
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{t.title}</h1>
        <div className="mt-1 text-[14px] text-muted">{whenLine(t, timezone)}</div>
      </div>

      <div className="space-y-4">
        {row.instructions && (
          <Card className="p-5">
            <div className="mb-1 text-[13px] text-muted">Instructions</div>
            <p className="whitespace-pre-wrap text-[14px]">{row.instructions}</p>
          </Card>
        )}
        <Card className="p-5">
          <ul className="space-y-2 text-[14px]">
            {rules.map((r) => (
              <li key={r} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">Your answers save as you go. If your connection drops, open the test again to carry on.</p>
        </Card>

        {t.inProgress ? (
          <Link href={`/${uni}/learn/tests/attempt/${t.inProgress.id}`} className={`${buttonClass("gold")} h-12 w-full text-[15px] sm:w-auto sm:px-8`}>
            Resume test
          </Link>
        ) : t.bucket === "available" ? (
          <StartTest uni={uni} testId={t.id} label={t.attempts.length ? `Start attempt ${t.attempts.length + 1}` : "Start test"} fullscreen={row.fullscreenRequired} />
        ) : t.window === "upcoming" ? (
          <Notice tone="neutral">This test opens {formatMoment(row.opensAt, timezone)}.</Notice>
        ) : t.window === "closed" ? (
          <Notice tone="neutral">This test has closed.</Notice>
        ) : (
          <Notice tone="neutral">You&apos;ve used all your attempts.</Notice>
        )}

        {t.attempts.length > 0 && (
          <section>
            <h2 className="mb-2 mt-6 text-[17px] font-medium">Your attempts</h2>
            <ul className="space-y-2">
              {t.attempts.map((a) => (
                <li key={a.id}>
                  <Link href={`/${uni}/learn/tests/attempt/${a.id}/result`} className="flex items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-3 text-[14px] hover:border-brand/40">
                    <span>
                      Attempt {a.attemptNo}
                      {a.submittedAt && <span className="text-muted"> · {formatMoment(a.submittedAt, timezone)}</span>}
                    </span>
                    {a.status === "awaiting_grading" ? (
                      <Badge tone="gold">Being graded</Badge>
                    ) : (
                      <Badge tone={a.passed ? "brand" : "danger"}>{fmtPercent(a.scorePercent)}</Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
