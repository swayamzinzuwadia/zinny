import Link from "next/link";
import { Card, CardTitle, Empty, buttonClass } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { formatTime } from "@/server/lib/dates";
import { myLearning } from "@/server/services/enrolment";
import { myNotifications } from "@/server/services/notifications";
import { myChildren, studentTimetable } from "@/server/services/timetable";

export const metadata = { title: "Home" };

export default async function LearnHome({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const isStudent = hasRole(actor, ["student", "alumni", "individual_learner"]);

  if (!isStudent) {
    // Parent: read-only view of each linked child's week.
    const children = await myChildren(actor);
    const weeks = await Promise.all(children.map((c) => studentTimetable(actor, undefined, c.id)));
    return (
      <div className="space-y-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Hello, {actor.name.split(" ")[0]}</h1>
        {children.length === 0 && <Empty title="No students linked yet">Ask the institute to link your child to your account.</Empty>}
        {children.map((c, i) => (
          <Card key={c.id}>
            <CardTitle hint="Read only">{c.name}&apos;s week</CardTitle>
            <WeekView from={weeks[i].from} today={weeks[i].today} sessions={weeks[i].sessions} compact />
          </Card>
        ))}
      </div>
    );
  }

  const [week, learning, notes] = await Promise.all([studentTimetable(actor), myLearning(actor), myNotifications(actor, 5)]);
  const today = week.sessions.filter((s) => s.date === week.today);
  const held = learning.filter((l) => l.status === "held");

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-semibold tracking-tight">Hi {actor.name.split(" ")[0]}</h1>

      {held.map((h) => (
        <Card key={h.enrolmentId} className="border-warn/30 bg-warn-soft">
          <div className="text-sm text-warn">
            Your seat in <b>{h.course.title}</b> ({h.batch.name}) is held for a few more minutes.{" "}
            <Link className="font-semibold underline" href={`/${uni}/learn/courses/${h.course.id}`}>
              Finish enrolling
            </Link>
          </div>
        </Card>
      ))}

      <Card>
        <CardTitle hint={<Link href={`/${uni}/learn/timetable`} className="text-brand">Full week</Link>}>Today&apos;s classes</CardTitle>
        {today.length === 0 ? (
          <p className="text-muted">No classes today.</p>
        ) : (
          <ul className="divide-y divide-line">
            {today.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-medium">{s.courseTitle}</div>
                  <div className="text-sm text-muted">
                    {formatTime(s.startTime)}–{formatTime(s.endTime)} · {s.batchName}
                    {s.faculty.length > 0 && ` · ${s.faculty.join(", ")}`}
                  </div>
                </div>
                {s.joinUrl && (
                  <a href={s.joinUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
                    Join
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardTitle hint={<Link href={`/${uni}/learn/my`} className="text-brand">All</Link>}>My courses</CardTitle>
          {learning.filter((l) => l.status === "active").length === 0 ? (
            <Empty title="No courses yet">
              <Link className="text-brand" href={`/${uni}/learn/courses`}>
                Browse courses
              </Link>
            </Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {learning
                .filter((l) => l.status === "active")
                .map((l) => (
                  <li key={l.enrolmentId}>
                    <div className="font-medium">{l.course.title}</div>
                    <div className="text-muted">
                      {l.batch.name} · {l.batch.timings}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Updates</CardTitle>
          {notes.length === 0 ? (
            <p className="text-muted">Nothing new.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {notes.map((n) => (
                <li key={n.id}>
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-muted">{n.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
