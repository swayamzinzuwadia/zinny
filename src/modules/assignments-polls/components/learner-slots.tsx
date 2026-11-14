/** Learner slot components: course hub tab, My learning section and home card. */
import Link from "next/link";
import { Card, CardTitle, Empty } from "@/components/ui";
import type { HomeCardProps, HubSectionProps, LearnerCourseTabProps } from "@/contracts/module";
import { can } from "@/server/core";
import { calendarDaysUntil, dueLabel, formatWhen } from "../lib/time";
import { learnAssignment, learnBase, pollsBase } from "../links";
import { myAssignments, myGrades } from "../service/assignments";
import { myPolls } from "../service/polls";
import { Score } from "./bits";
import { AssignmentRow, PollCard, groupAssignments } from "./learner-bits";

/** learnerCourseTabs.assignments: this course's assignments and polls. */
export async function LearnerAssignmentsTab({ uni, actor, course, university }: LearnerCourseTabProps) {
  const own = { universityId: university.id, ownerUserId: actor.userId };
  const [list, polls] = await Promise.all([
    myAssignments(actor, { courseId: course.id }),
    can(actor, "self.vote", own) ? myPolls(actor, { courseId: course.id }) : Promise.resolve([]),
  ]);
  const tz = university.timezone;
  const groups = groupAssignments(list);
  const livePolls = polls.filter((p) => p.state !== "upcoming").slice(0, 4);
  return (
    <div className="space-y-6">
      {livePolls.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[17px] font-medium">Polls</h2>
            <Link href={pollsBase(uni)} className="inline-block py-1.5 text-[13px] text-brand">
              All polls
            </Link>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {livePolls.map((p) => (
              <PollCard key={p.id} uni={uni} p={p} tz={tz} showCourse={false} />
            ))}
          </div>
        </section>
      )}
      {groups.length === 0 ? (
        <Empty title="No assignments yet">Your teachers&apos; assignments for this course will show up here.</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-2 text-[17px] font-medium">
              {g.title} <span className="text-[14px] font-normal text-faint">{g.items.length}</span>
            </h2>
            <div className="space-y-2.5">
              {g.items.map((a) => (
                <AssignmentRow key={a.id} uni={uni} a={a} tz={tz} showCourse={false} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** learnerHubSections.assignment-grades: the student's graded work. Nothing until something is graded. */
export async function AssignmentGradesSection({ uni, actor, university }: HubSectionProps) {
  const graded = await myGrades(actor);
  if (graded.length === 0) return null;
  const tz = university.timezone;
  return (
    <Card>
      <CardTitle hint={`${graded.length} graded`}>Assignment grades</CardTitle>
      <ul className="divide-y divide-line">
        {graded.slice(0, 8).map((a) => (
          <li key={a.id}>
            <Link href={learnAssignment(uni, a.id)} className="flex items-center justify-between gap-3 py-3 hover:text-brand">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{a.title}</div>
                <div className="text-[13px] text-muted">
                  {a.courseTitle}
                  {a.gradedAt && ` · ${formatWhen(a.gradedAt, tz)}`}
                  {a.late && " · Late"}
                </div>
              </div>
              <Score marks={a.finalMarks} points={a.points} percent={a.scorePercent} className="shrink-0 text-[14px]" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href={learnBase(uni)} className="mt-1 inline-block py-1.5 text-[13px] font-medium text-brand hover:underline">
        See all assignments
      </Link>
    </Card>
  );
}

/** Rows on the home card; the assignments and polls pages have the rest. */
const DUE_SHOWN = 3;

/**
 * learnerHomeCards.due-soon: work due in the next 7 days (and late work still accepted),
 * plus open polls the student hasn't voted in, as plain rows (at most three, keeping one
 * for a poll when there is one). A gold dot marks only what is due today. Nothing when
 * there's nothing to do.
 */
export async function DueSoonCard({ uni, actor, university }: HomeCardProps) {
  const own = { universityId: university.id, ownerUserId: actor.userId };
  const now = new Date();
  const tz = university.timezone;
  const [list, polls] = await Promise.all([myAssignments(actor), can(actor, "self.vote", own) ? myPolls(actor) : Promise.resolve([])]);
  const due = list
    .filter((a) => (a.status === "due" && calendarDaysUntil(a.dueAt, tz, now) <= 7) || a.status === "overdue")
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const toVote = polls.filter((p) => p.canVote);
  if (due.length === 0 && toVote.length === 0) return null;
  const pollRows = toVote.slice(0, Math.max(DUE_SHOWN - due.length, 1));
  const dueRows = due.slice(0, DUE_SHOWN - pollRows.length);
  const total = due.length + toVote.length;
  const hidden = total - dueRows.length - pollRows.length;
  return (
    <Card className="p-5">
      <CardTitle
        hint={
          <Link href={learnBase(uni)} className="inline-block py-1 font-medium text-brand hover:underline">
            {hidden > 0 ? `See all ${total}` : "All assignments"}
          </Link>
        }
      >
        Due soon
      </CardTitle>
      <ul className="-my-3 divide-y divide-line">
        {dueRows.map((a) => {
          const today = a.status === "due" && calendarDaysUntil(a.dueAt, tz, now) === 0;
          return (
            <li key={a.id}>
              <Link href={learnAssignment(uni, a.id)} className="group block py-3">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium leading-snug group-hover:text-brand">
                    {today && <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full bg-gold align-middle" />}
                    {a.title}
                  </span>
                  <span className={a.status === "overdue" ? "block text-[13px] text-danger" : "block text-[13px] text-muted"}>
                    {a.courseTitle} · {dueLabel(a.dueAt, tz, now)}
                    {a.status === "overdue" && `. Late work accepted${a.latePenaltyPct ? `, with ${a.latePenaltyPct}% off` : ""}`}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {pollRows.map((p) => (
          <li key={p.id}>
            <Link href={pollsBase(uni)} className="group flex items-start justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block text-[14px] font-medium leading-snug group-hover:text-brand">{p.question}</span>
                <span className="block text-[13px] text-muted">
                  Poll closes {formatWhen(p.closesAt, tz, now)}
                </span>
              </span>
              <span className="shrink-0 pt-px text-[13px] font-medium text-brand">Vote</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
