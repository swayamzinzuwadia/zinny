/** Learner slot components: course hub tab, My learning section and home card. */
import Link from "next/link";
import { Card, CardTitle, Empty } from "@/components/ui";
import type { HomeCardProps, HubSectionProps, LearnerCourseTabProps } from "@/contracts/module";
import { can } from "@/server/core";
import { calendarDaysUntil, formatWhen } from "../lib/time";
import { learnAssignment, learnBase, pollsBase } from "../links";
import { myAssignments, myGrades } from "../service/assignments";
import { myPolls } from "../service/polls";
import { Score } from "./bits";
import { AssignmentRow, PollCard, groupAssignments, isDueSoon } from "./learner-bits";

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
            <Link href={pollsBase(uni)} className="text-[13px] text-brand">
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
                <div className="truncate text-[13px] text-muted">
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
      <Link href={learnBase(uni)} className="mt-2 inline-block text-[13px] font-medium text-brand hover:underline">
        See all assignments
      </Link>
    </Card>
  );
}

/**
 * learnerHomeCards.due-soon: work due in the next 7 days (and late work still accepted),
 * plus open polls the student hasn't voted in. Nothing when there's nothing to do.
 */
export async function DueSoonCard({ uni, actor, university }: HomeCardProps) {
  const own = { universityId: university.id, ownerUserId: actor.userId };
  const now = new Date();
  const tz = university.timezone;
  const [list, polls] = await Promise.all([myAssignments(actor), can(actor, "self.vote", own) ? myPolls(actor) : Promise.resolve([])]);
  const due = list.filter((a) => (a.status === "due" && calendarDaysUntil(a.dueAt, tz, now) <= 7) || a.status === "overdue");
  const toVote = polls.filter((p) => p.canVote);
  if (due.length === 0 && toVote.length === 0) return null;
  return (
    <Card>
      <CardTitle hint={`${due.length + toVote.length} to do`}>Due soon</CardTitle>
      <ul className="space-y-2.5">
        {due.slice(0, 5).map((a) => (
          <li key={a.id}>
            <AssignmentRow uni={uni} a={a} tz={tz} now={now} />
          </li>
        ))}
        {toVote.slice(0, 2).map((p) => (
          <li key={p.id}>
            <Link href={pollsBase(uni)} className="flex items-center justify-between gap-3 rounded-[18px] border border-gold/70 bg-surface p-4 hover:border-brand/40">
              <div className="min-w-0">
                <div className="text-[15px] font-medium leading-snug">{p.question}</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {p.courseTitle} · Poll closes {formatWhen(p.closesAt, tz, now)}
                </div>
              </div>
              <span className="shrink-0 text-[13px] font-medium text-brand">Vote</span>
            </Link>
          </li>
        ))}
      </ul>
      {(due.length > 5 || due.some((a) => isDueSoon(a, tz, now))) && (
        <Link href={learnBase(uni)} className="mt-3 inline-block text-[13px] font-medium text-brand hover:underline">
          See all assignments
        </Link>
      )}
    </Card>
  );
}
