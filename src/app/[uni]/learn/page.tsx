import Link from "next/link";
import { redirect } from "next/navigation";
import { SlotList } from "@/components/slots";
import { Card, CardTitle, Empty, buttonClass, cx } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { joinPath, joinWindowOpen } from "@/server/lib/links";
import { visibleSlots } from "@/server/registry";
import { addDays, formatDate, formatTime, minutesNowIn, toMinutes, todayIn, weekStart } from "@/server/lib/dates";
import { myLearning } from "@/server/services/enrolment";
import { myNotifications } from "@/server/services/notifications";
import { myChildren, studentTimetable } from "@/server/services/timetable";
import { DayAgenda } from "./day-agenda";

export const metadata = { title: "Today" };

/** The timetable's course colours (src/components/week-view.tsx), as dots. No gold: it marks "now". */
const COURSE_DOT = ["bg-brand", "bg-[#2f4a72]", "bg-[#7a3d66]", "bg-[#7a4a2d]"];

/** Home cards from this order on come after the student's own learning (the marketplace). */
const LATER_CARDS_FROM = 900;
/** Cards before this order sit in the main column; the rest (XP) in the side column. */
const SIDE_CARDS_FROM = 500;
/** The board already shows the next class with its Join button; the live-classes card would repeat it. */
const SHOWN_ON_BOARD = new Set(["join-next"]);
/** What needs doing comes before what to carry on with. The registered orders (contracts.md) stay as they are. */
const MAIN_FIRST = ["due-soon", "continue-learning", "upcoming-tests"];
/** Updates on the home page; the updates page has the rest. */
const UPDATES_SHOWN = 3;

/** "Saturday, 14 November": the page's title is the day. */
function dayTitle(date: string) {
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")}`;
}

function startsIn(mins: number) {
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

const sessionKey = (s: { date: string; batchId: string; startTime: string }) => `${s.date} ${s.batchId} ${s.startTime}`;

export default async function LearnHome({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!hasRole(actor, ["student", "alumni", "parent"])) redirect("/marketplace/library");
  const isStudent = hasRole(actor, ["student", "alumni"]);
  const nowMin = minutesNowIn(university.timezone);

  if (!isStudent) {
    // Parent: read-only view of each linked child's week.
    const children = await myChildren(actor);
    const weeks = await Promise.all(children.map((c) => studentTimetable(actor, undefined, c.id)));
    return (
      <div className="space-y-6">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{dayTitle(todayIn(university.timezone))}</h1>
        {children.length === 0 && <Empty title="No students linked yet">Ask the institute to link your child to your account.</Empty>}
        {children.map((c, i) => (
          <Card key={c.id} className="p-5">
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
    myNotifications(actor, UPDATES_SHOWN),
  ]);
  const active = learning.filter((l) => l.status === "active");
  // Same order as the timetable (this week's courses as they come), then the rest.
  const courseOrder = [...new Set([...week.sessions.map((s) => s.courseId), ...active.map((l) => l.course.id)])];
  const colorOf = (courseId: string) => COURSE_DOT[Math.max(0, courseOrder.indexOf(courseId)) % COURSE_DOT.length];
  const cards = visibleSlots("learnerHomeCards", actor, { universityId: university.id, ownerUserId: actor.userId }).filter((c) => !SHOWN_ON_BOARD.has(c.key));
  const rank = (key: string) => (MAIN_FIRST.includes(key) ? MAIN_FIRST.indexOf(key) : MAIN_FIRST.length);
  const mainCards = cards.filter((c) => c.order < SIDE_CARDS_FROM).sort((a, b) => rank(a.key) - rank(b.key) || a.order - b.order);
  const sideCards = cards.filter((c) => c.order >= SIDE_CARDS_FROM && c.order < LATER_CARDS_FROM);
  const laterCards = cards.filter((c) => c.order >= LATER_CARDS_FROM);
  const slotProps = { uni, actor, university, today };

  const next = ahead.sessions.find((s) => s.date > today || toMinutes(s.endTime) > nowMin);
  const isLive = !!next && next.date === today && toMinutes(next.startTime) <= nowMin;
  const nextEnrolment = next && active.find((l) => l.batch.id === next.batchId);
  const when = !next
    ? ""
    : isLive
      ? `Until ${formatTime(next.endTime)}`
      : next.date === today
        ? `Today at ${formatTime(next.startTime)}${toMinutes(next.startTime) - nowMin <= 360 ? `, ${startsIn(toMinutes(next.startTime) - nowMin)}` : ""}`
        : next.date === addDays(today, 1)
          ? `Tomorrow at ${formatTime(next.startTime)}`
          : `${formatDate(next.date, { weekday: true })} at ${formatTime(next.startTime)}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i));
  const boardLink = "inline-block py-1 text-[13px] sm:text-[14px] text-canvas/80 underline-offset-4 hover:text-canvas hover:underline";
  const cardLink = "inline-block py-1 font-medium text-brand hover:underline";

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* The board: the day, then the live or next class */}
      <section className="relative overflow-hidden rounded-[var(--radius-board)] bg-brand-deep p-5 text-canvas sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
        />
        <div className="relative">
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">{dayTitle(today)}</h1>
          {next ? (
            <div className="mt-4 border-t border-canvas/15 pt-4">
              <div className="flex items-center gap-2 text-[13px]">
                {isLive ? (
                  <>
                    <span aria-hidden className="now-dot h-2 w-2 rounded-full bg-gold" />
                    <span className="font-medium text-gold">Live now</span>
                  </>
                ) : (
                  <span className="text-canvas/70">Next class</span>
                )}
              </div>
              <div className="mt-1 text-[22px] font-medium leading-snug sm:text-[24px]">{next.courseTitle}</div>
              <div className="mt-0.5 text-[14px] text-canvas/75">
                {when}
                {next.faculty.length > 0 && `, with ${next.faculty.join(" and ")}`}
              </div>
              {next.clashesWith && (
                <div className="mt-2 flex items-center gap-2 text-[13px] font-medium text-gold">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-gold" />
                  Clashes with {[...new Set(next.clashesWith.map((c) => c.courseTitle))].join(" and ")}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                {joinWindowOpen(next, today, nowMin) ? (
                  // A plain link, never prefetched: the join route records attendance, then redirects to the
                  // meeting. Shown for every class (a per-class link counts too) once the window opens.
                  <a href={joinPath(uni, next.batchId, next.date, next.startTime)} target="_blank" rel="noreferrer" className={buttonClass("gold")}>
                    Join class
                  </a>
                ) : null}
                {nextEnrolment && (
                  <Link href={`/${uni}/learn/my/${nextEnrolment.enrolmentId}?tab=live`} className={boardLink}>
                    Attendance
                  </Link>
                )}
                <Link href={`/${uni}/learn/timetable`} className={boardLink}>
                  Full timetable
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-4 border-t border-canvas/15 pt-4 text-[15px] text-canvas/80">
              No classes in the next two weeks.{" "}
              <Link href={`/${uni}/learn/courses`} className="text-gold underline underline-offset-4">
                Find a course
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* This week: tap a day to see its classes. Today's list leaves out the class already on the board. */}
      <DayAgenda
        days={days}
        today={today}
        nowMin={nowMin}
        sessions={week.sessions}
        onBoard={next ? sessionKey(next) : null}
        dotFor={Object.fromEntries(week.sessions.map((s) => [s.courseId, colorOf(s.courseId)]))}
        timetableHref={`/${uni}/learn/timetable`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr] lg:gap-6">
        <SlotList slot="learnerHomeCards" className="space-y-4" entries={mainCards} props={slotProps} />

        <div className="space-y-4">
          <Card className="p-5">
            <CardTitle
              hint={
                notes.length > 0 ? (
                  <Link href={`/${uni}/learn/updates`} className={cardLink}>
                    See all
                  </Link>
                ) : undefined
              }
            >
              Updates
            </CardTitle>
            {notes.length === 0 ? (
              <p className="text-[14px] text-muted">Nothing new.</p>
            ) : (
              <ul className="-my-3 divide-y divide-line">
                {notes.map((n) => (
                  <li key={n.id} className="py-3 text-[14px]">
                    {n.title}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <SlotList slot="learnerHomeCards" className="space-y-4" entries={sideCards} props={slotProps} />

          <Card className="p-5">
            <CardTitle
              hint={
                <Link href={`/${uni}/learn/courses`} className={cardLink}>
                  Browse courses
                </Link>
              }
            >
              My courses
            </CardTitle>
            {active.length === 0 ? (
              <p className="text-[14px] text-muted">
                You haven&apos;t joined a course yet.{" "}
                <Link className="text-brand hover:underline" href={`/${uni}/learn/courses`}>
                  Pick a course and a batch that fits your week
                </Link>
              </p>
            ) : (
              <ul className="-my-3 divide-y divide-line">
                {active.map((l) => (
                  <li key={l.enrolmentId}>
                    <Link href={`/${uni}/learn/my/${l.enrolmentId}`} className="group flex items-start gap-3 py-3">
                      <span aria-hidden className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", colorOf(l.course.id))} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium group-hover:text-brand">{l.course.title}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {[l.batch.name, l.batch.timings].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <SlotList slot="learnerHomeCards" className="space-y-4" entries={laterCards} props={slotProps} />
        </div>
      </div>
    </div>
  );
}
