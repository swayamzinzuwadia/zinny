import Link from "next/link";
import { Badge, cx } from "@/components/ui";
import { KIND_LABEL, fmtPercent, plural } from "../lib/labels";
import type { MySeries, MyTest } from "../learner";
import { formatMinutes, formatMoment } from "../lib/time";

export function whenLine(t: Pick<MyTest, "window" | "opensAt" | "closesAt">, timezone: string) {
  if (t.window === "upcoming" && t.opensAt) return `Opens ${formatMoment(t.opensAt, timezone)}`;
  if (t.window === "closed" && t.closesAt) return `Closed ${formatMoment(t.closesAt, timezone)}`;
  if (t.closesAt) return `Due ${formatMoment(t.closesAt, timezone)}`;
  return "Open any time";
}

function ResultBadge({ t }: { t: MyTest }) {
  if (!t.best) return null;
  if (t.best.status === "awaiting_grading") return <Badge tone="gold">Being graded</Badge>;
  return <Badge tone={t.best.passed ? "brand" : "danger"}>{fmtPercent(t.best.scorePercent)}</Badge>;
}

/** One test in the learner's list. Mobile first: a full-width tappable card. */
export function TestCard({ t, uni, timezone, compact }: { t: MyTest; uni: string; timezone: string; compact?: boolean }) {
  const href = t.inProgress ? `/${uni}/learn/tests/attempt/${t.inProgress.id}` : `/${uni}/learn/tests/${t.id}`;
  const facts = [
    plural(t.questionCount, "question"),
    t.timeLimitMinutes ? formatMinutes(t.timeLimitMinutes) : "No time limit",
    t.attemptLimit > 1 ? `${t.attempts.length} of ${t.attemptLimit} attempts used` : null,
  ].filter(Boolean);
  const urgent = t.bucket === "available" && t.closesAt && t.closesAt.getTime() - Date.now() < 24 * 3600_000;
  return (
    <Link
      href={href}
      className={cx(
        "block rounded-[22px] border bg-surface p-4 transition-colors hover:border-brand/40 sm:p-5",
        t.inProgress ? "border-gold ring-2 ring-gold-soft" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-muted">
            {KIND_LABEL[t.kind]}
            {!compact && ` · ${t.courseTitle}`}
          </div>
          <div className="mt-0.5 text-[16px] font-medium leading-snug">{t.title}</div>
        </div>
        <ResultBadge t={t} />
      </div>
      <div className="mt-2 text-[13px] text-muted">{facts.join(" · ")}</div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
        <span className={cx(urgent ? "font-medium text-gold-strong" : "text-muted")}>{whenLine(t, timezone)}</span>
        {t.inProgress ? (
          <span className="font-medium text-gold-strong">Resume</span>
        ) : t.bucket === "available" ? (
          <span className="font-medium text-brand">{t.attempts.length ? "Try again" : "Start"}</span>
        ) : t.attempts.length ? (
          <span className="text-brand">See result</span>
        ) : null}
      </div>
    </Link>
  );
}

/** A test series: one item, its tests in order. */
export function SeriesCard({ s, uni, timezone }: { s: MySeries; uni: string; timezone: string }) {
  const next = s.tests.find((t) => t.bucket === "available");
  return (
    <Link href={`/${uni}/learn/tests/series/${s.id}`} className="block rounded-[22px] border border-line bg-surface p-4 hover:border-brand/40 sm:p-5">
      <div className="text-[12px] text-muted">Test series · {s.courseTitle}</div>
      <div className="mt-0.5 text-[16px] font-medium">{s.title}</div>
      <div className="mt-3 flex gap-1" aria-label={`${s.done} of ${s.tests.length} tests taken`}>
        {s.tests.map((t) => (
          <span key={t.id} className={cx("h-1.5 flex-1 rounded-full", t.attempts.length ? "bg-brand" : t.bucket === "available" ? "bg-gold" : "bg-line")} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px] text-muted">
        <span>
          {s.done} of {plural(s.tests.length, "test")} taken
        </span>
        {next && <span className="font-medium text-brand">Next: {next.title}</span>}
      </div>
      <span className="sr-only">{whenLine(s.tests[0], timezone)}</span>
    </Link>
  );
}
