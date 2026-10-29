/** Learner list rows and the vote form (server components, mobile first). */
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { cx } from "@/components/ui";
import { voteAction } from "../actions";
import { calendarDaysUntil, dueLabel, formatWhen } from "../lib/time";
import { learnAssignment } from "../links";
import type { LearnerAssignment } from "../service/assignments";
import type { LearnerPoll } from "../service/polls";
import { ResultBars, Score, StatusBadge } from "./bits";

/** Due within a day and not handed in: shown in gold ("needs attention"). */
export function isDueSoon(a: Pick<LearnerAssignment, "status" | "dueAt">, tz: string, now = new Date()) {
  return (a.status === "due" && calendarDaysUntil(a.dueAt, tz, now) <= 1) || a.status === "overdue";
}

export function AssignmentRow({ uni, a, tz, showCourse = true, now = new Date() }: { uni: string; a: LearnerAssignment; tz: string; showCourse?: boolean; now?: Date }) {
  const soon = isDueSoon(a, tz, now);
  return (
    <Link
      href={learnAssignment(uni, a.id)}
      className={cx(
        "flex items-start justify-between gap-3 rounded-[18px] border bg-surface p-4 hover:border-brand/40",
        soon ? "border-gold/70" : "border-line",
      )}
    >
      <div className="min-w-0">
        <div className="text-[15px] font-medium leading-snug">{a.title}</div>
        <div className="mt-0.5 text-[13px] text-muted">
          {showCourse && `${a.courseTitle} · `}
          {a.status === "graded"
            ? `Graded ${a.gradedAt ? formatWhen(a.gradedAt, tz, now) : ""}`
            : a.status === "submitted"
              ? `Handed in ${a.submittedAt ? formatWhen(a.submittedAt, tz, now) : ""}`
              : dueLabel(a.dueAt, tz, now)}
        </div>
        {a.status === "overdue" && (
          <div className="mt-0.5 text-[12px] text-danger">
            Late work accepted{a.latePenaltyPct ? `, with ${a.latePenaltyPct}% off` : ""}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={a.status} late={a.late} dueSoon={soon} />
        {a.status === "graded" && <Score marks={a.finalMarks} points={a.points} className="text-[14px]" />}
      </div>
    </Link>
  );
}

export function PollCard({ uni, p, tz, now = new Date(), showCourse = true }: { uni: string; p: LearnerPoll; tz: string; now?: Date; showCourse?: boolean }) {
  return (
    <div className={cx("rounded-[18px] border bg-surface p-4", p.canVote ? "border-gold/70" : "border-line")}>
      <div className="text-[12px] text-muted">
        {showCourse && `${p.courseTitle} · `}
        {p.state === "open" ? `Closes ${formatWhen(p.closesAt, tz, now)}` : p.state === "upcoming" ? `Opens ${formatWhen(p.opensAt, tz, now)}` : `Closed ${formatWhen(p.closesAt, tz, now)}`}
        {p.anonymous && " · Anonymous"}
      </div>
      <h3 className="mt-1 text-[15px] font-medium leading-snug">{p.question}</h3>
      {p.canVote ? (
        <ActionForm action={voteAction} className="mt-3" resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="pollId" value={p.id} />
          <fieldset className="space-y-2">
            <legend className="sr-only">{p.question}</legend>
            {p.options.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-[14px] has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="optionId" value={o.id} required className="accent-brand" />
                {o.label}
              </label>
            ))}
          </fieldset>
          <div className="mt-3">
            <SubmitButton size="sm">Vote</SubmitButton>
          </div>
          <p className="mt-2 text-[12px] text-muted">You can vote once. {p.anonymous ? "Nobody can see what you chose." : "Your teachers can see what you chose."}</p>
        </ActionForm>
      ) : p.results ? (
        <div className="mt-3">
          <ResultBars options={p.results.options} total={p.results.totalVotes} />
          {p.voted && <p className="mt-2 text-[12px] text-muted">You voted{p.myOptionId ? ` for ${p.options.find((o) => o.id === p.myOptionId)?.label}` : ""}.</p>}
        </div>
      ) : (
        <p className="mt-2 text-[14px] text-muted">
          {p.voted
            ? `You voted${p.myOptionId ? ` for ${p.options.find((o) => o.id === p.myOptionId)?.label}` : ""}.${p.state === "open" ? " Results come after the poll closes." : ""}`
            : p.state === "upcoming"
              ? "Voting hasn't started yet."
              : p.state === "closed"
                ? "This poll has closed."
                : "Voting is open to current students."}
        </p>
      )}
    </div>
  );
}

/** Groups for the assignments list, in the order a student acts on them. */
export function groupAssignments(list: LearnerAssignment[]) {
  return [
    { key: "todo", title: "To do", items: list.filter((a) => a.status === "due" || a.status === "overdue") },
    { key: "submitted", title: "Handed in", items: list.filter((a) => a.status === "submitted") },
    { key: "graded", title: "Graded", items: list.filter((a) => a.status === "graded").sort((x, y) => (y.gradedAt?.getTime() ?? 0) - (x.gradedAt?.getTime() ?? 0)) },
    { key: "missed", title: "Missed", items: list.filter((a) => a.status === "missed").sort((x, y) => y.dueAt.getTime() - x.dueAt.getTime()) },
  ].filter((g) => g.items.length > 0);
}
