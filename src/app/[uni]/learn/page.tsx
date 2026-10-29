import Link from "next/link";
import { SlotList } from "@/components/slots";
import { Card, CardTitle, Empty, buttonClass, cx } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { joinPath, joinWindowOpen } from "@/server/lib/links";
import { visibleSlots } from "@/server/registry";
import { addDays, formatDate, formatTime, minutesNowIn, toMinutes, weekStart } from "@/server/lib/dates";
import { greetingFor } from "@/server/services/dashboard";
import { myLearning } from "@/server/services/enrolment";
import { myNotifications } from "@/server/services/notifications";
import { myChildren, studentTimetable } from "@/server/services/timetable";
import { DayAgenda } from "./day-agenda";

export const metadata = { title: "Today" };

const COURSE_DOT = ["bg-brand", "bg-gold", "bg-[#2f4a72]", "bg-[#7a3d66]"];

function startsIn(mins: number) {
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

export default async function LearnHome({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const isStudent = hasRole(actor, ["student", "alumni", "individual_learner"]);
  const first = actor.name.split(" ")[0];
  const nowMin = minutesNowIn(university.timezone);

  if (!isStudent) {
    // Parent: read-only view of each linked child's week.
    const children = await myChildren(actor);
    const weeks = await Promise.all(children.map((c) => studentTimetable(actor, undefined, c.id)));
    return (
      <div className="space-y-6">
        <h1 className="text-[30px] font-semibold">
          {greetingFor(nowMin)}, {first}
        </h1>
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

  const week = await studentTimetable(actor);
  const today = week.today;
  const [ahead, learning, notes] = await Promise.all([
    studentTimetable(actor, { from: today, to: addDays(today, 14) }),
    myLearning(actor),
    myNotifications(actor, 4),
  ]);
  const active = learning.filter((l) => l.status === "active");
  const held = learning.filter((l) => l.status === "held");
  const colorOf = (courseId: string) =>
    COURSE_DOT[
      Math.max(
        0,
        active.findIndex((l) => l.course.id === courseId),
      ) % COURSE_DOT.length
    ];

  const next = ahead.sessions.find((s) => s.date > today || toMinutes(s.endTime) > nowMin);
  const isLive = next && next.date === today && toMinutes(next.startTime) <= nowMin;
  const when = !next
    ? ""
    : isLive
      ? `Live now, until ${formatTime(next.endTime)}`
      : next.date === today
        ? `Today at ${formatTime(next.startTime)}${toMinutes(next.startTime) - nowMin <= 360 ? `, ${startsIn(toMinutes(next.startTime) - nowMin)}` : ""}`
        : next.date === addDays(today, 1)
          ? `Tomorrow at ${formatTime(next.startTime)}`
          : `${formatDate(next.date, { weekday: true })} at ${formatTime(next.startTime)}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));

  return (
    <div className="space-y-6">
      {/* Hero: the next class, on the chalkboard */}
      <section className="relative overflow-hidden rounded-[var(--radius-board)] bg-brand-deep p-6 text-canvas sm:p-9">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
        />
        <div className="relative">
          <div className="text-[14px] text-canvas/65">{formatDate(today, { weekday: true })}</div>
          <h1 className="mt-1 text-[32px] font-semibold leading-tight sm:text-[40px]">
            {greetingFor(nowMin)}, {first}
          </h1>
          {next ? (
            <div
              className={cx(
                "mt-7 rounded-[22px] border p-5 sm:p-6",
                isLive ? "border-gold bg-gold text-brand-deep" : "border-gold/60 bg-canvas/[0.07]",
              )}
            >
              <div className={cx("text-[13px]", isLive ? "font-medium" : "text-gold")}>{isLive ? "Your class is on" : "Next class"}</div>
              <div className="mt-1 text-[24px] font-semibold leading-tight sm:text-[28px]">{next.courseTitle}</div>
              <div className={cx("mt-1 text-[14px]", isLive ? "text-brand-deep/80" : "text-canvas/75")}>
                {when}
                {next.faculty.length > 0 && `, with ${next.faculty.join(" and ")}`}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {joinWindowOpen(next, today, nowMin) ? (
                  // A plain link, never prefetched: the join route records attendance, then redirects to the
                  // meeting. Shown for every class (a per-class link counts too) once the window opens.
                  <a href={joinPath(uni, next.batchId, next.date, next.startTime)} target="_blank" rel="noreferrer" className={buttonClass(isLive ? "primary" : "gold")}>
                    Join class
                  </a>
                ) : null}
                <Link
                  href={`/${uni}/learn/timetable`}
                  className={cx("text-[14px] underline-offset-4 hover:underline", isLive ? "text-brand-deep" : "text-canvas/80")}
                >
                  See the full timetable
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-6 text-[15px] text-canvas/80">
              No classes in the next two weeks.{" "}
              <Link href={`/${uni}/learn/courses`} className="text-gold underline underline-offset-4">
                Find a course
              </Link>
            </div>
          )}
        </div>
      </section>

      {held.map((h) => (
        <div
          key={h.enrolmentId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-gold-soft px-5 py-4 text-[14px]"
        >
          <span className="text-ink">
            Your seat in {h.course.title}, {h.batch.name} is held for a few more minutes.
          </span>
          <Link className={buttonClass("primary", "sm")} href={`/${uni}/learn/courses/${h.course.id}`}>
            Finish enrolling
          </Link>
        </div>
      ))}

      {/* This week: tap a day to see its classes */}
      <DayAgenda
        days={days}
        today={today}
        nowMin={nowMin}
        sessions={week.sessions}
        dotFor={Object.fromEntries(week.sessions.map((s) => [s.courseId, colorOf(s.courseId)]))}
        timetableHref={`/${uni}/learn/timetable`}
      >
        <Card>
          <CardTitle>Updates</CardTitle>
          {notes.length === 0 ? (
            <p className="text-[14px] text-muted">Nothing new.</p>
          ) : (
            <ul className="space-y-3.5 text-[14px]">
              {notes.map((n) => (
                <li key={n.id}>
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-muted">{n.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DayAgenda>

      <SlotList
        slot="learnerHomeCards"
        className="grid gap-6 lg:grid-cols-2"
        entries={visibleSlots("learnerHomeCards", actor, { universityId: university.id, ownerUserId: actor.userId })}
        props={{ uni, actor, university, today }}
      />

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[17px] font-medium">My courses</h2>
          <Link href={`/${uni}/learn/courses`} className="text-[13px] text-brand">
            Browse courses
          </Link>
        </div>
        {active.length === 0 ? (
          <Empty title="You haven't joined a course yet">
            <Link className="text-brand" href={`/${uni}/learn/courses`}>
              Pick a course and a batch that fits your week
            </Link>
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((l) => (
              <Link
                key={l.enrolmentId}
                href={`/${uni}/learn/my/${l.enrolmentId}`}
                className="group rounded-[22px] border border-line bg-surface p-5 hover:border-brand/40"
              >
                <span className={cx("mb-4 block h-1.5 w-10 rounded-full", colorOf(l.course.id))} />
                <div className="text-[16px] font-medium group-hover:text-brand">{l.course.title}</div>
                <div className="mt-1 text-[13px] text-muted">{l.batch.name}</div>
                <div className="text-[13px] text-muted">{l.batch.timings}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
