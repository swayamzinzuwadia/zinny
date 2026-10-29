import Link from "next/link";
import { SlotList } from "@/components/slots";
import { Card, CardTitle, Empty, buttonClass, cx } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { joinPath } from "@/server/lib/links";
import { visibleSlots } from "@/server/registry";
import { addDays, formatDate, formatTime, isoWeekday, minutesNowIn, toMinutes, weekStart, weekdayLabel } from "@/server/lib/dates";
import { greetingFor } from "@/server/services/dashboard";
import { myLearning } from "@/server/services/enrolment";
import { myNotifications } from "@/server/services/notifications";
import { myChildren, studentTimetable } from "@/server/services/timetable";

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
  const todays = week.sessions.filter((s) => s.date === today);
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
                {next.joinUrl && (next.date === today || isLive) ? (
                  // A plain link, never prefetched: the join route records attendance, then redirects to the meeting.
                  <a href={joinPath(uni, next.batchId, next.date)} target="_blank" rel="noreferrer" className={buttonClass(isLive ? "primary" : "gold")}>
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

      {/* This week, one tile per day */}
      <Link href={`/${uni}/learn/timetable`} className="grid grid-cols-7 gap-1.5 sm:gap-3">
        {days.map((d) => {
          const items = week.sessions.filter((s) => s.date === d);
          const isToday = d === today;
          return (
            <div
              key={d}
              className={cx(
                "rounded-[18px] border px-1 py-3 text-center",
                isToday ? "border-gold bg-surface ring-2 ring-gold-soft" : "border-line bg-surface/70",
              )}
            >
              <div className={cx("text-[12px]", isToday ? "font-medium text-gold-strong" : "text-muted")}>
                {weekdayLabel(isoWeekday(d))}
              </div>
              <div className="tabular text-[20px] font-semibold leading-tight">{Number(d.slice(8))}</div>
              <div className="mt-1.5 flex h-2 justify-center gap-1">
                {items.slice(0, 4).map((s, i) => (
                  <span key={i} className={cx("h-1.5 w-1.5 rounded-full", colorOf(s.courseId))} />
                ))}
              </div>
            </div>
          );
        })}
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardTitle hint={todays.length ? `${todays.length} class${todays.length === 1 ? "" : "es"}` : undefined}>Today</CardTitle>
          {todays.length === 0 ? (
            <p className="text-[14px] text-muted">No classes today. Use the time to catch up on lessons.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {todays.map((s, i) => {
                const done = toMinutes(s.endTime) <= nowMin;
                const now = !done && toMinutes(s.startTime) <= nowMin;
                return (
                  <li key={i} className={cx("relative", done && "opacity-55")}>
                    <span
                      className={cx(
                        "absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface",
                        now ? "now-dot bg-gold" : colorOf(s.courseId),
                      )}
                    />
                    <div className="tabular text-[13px] text-muted">
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                      {now && <span className="ml-2 font-medium text-gold-strong">Now</span>}
                    </div>
                    <div className="font-medium">{s.courseTitle}</div>
                    <div className="text-[13px] text-muted">
                      {s.batchName}
                      {s.faculty.length > 0 && `, with ${s.faculty.join(" and ")}`}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

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
      </div>

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
