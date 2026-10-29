/**
 * Staff screens inside core pages: the batch page's Attendance section, the course page's
 * Live classes tab and the dashboard's "Attendance today" card. Desktop and tablet.
 */
import Link from "next/link";
import type { BatchSectionProps, CourseTabProps, DashboardCardProps } from "@/contracts/module";
import { Badge, buttonClass, Card, CardTitle, cx, Empty } from "@/components/ui";
import { attendanceHref, registerHref, startHref } from "../links";
import { batchAttendance, courseLive, todaysClasses } from "../overview";
import { formatTime, relativeDay } from "../time";
import { KindNote, LinkText, Pct, PctBar, StateBadge, when } from "./bits";
import { StartClassButton } from "./client";

/* ─────────────── Batch page section ─────────────── */

export async function BatchAttendanceSection({ uni, actor, batch }: BatchSectionProps) {
  const data = await batchAttendance(actor, batch.id);
  const below = data.students.filter((s) => s.below && s.current);
  const recent = data.past.slice(0, 5);
  const today = data.upcoming.find((s) => s.date === data.today) ?? data.past.find((s) => s.date === data.today && s.state === "live");
  return (
    <Card>
      <CardTitle hint={`Minimum ${data.threshold}%`}>Attendance</CardTitle>
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <div>
          <div className="text-[13px] text-muted">Across {data.recordedClasses} class{data.recordedClasses === 1 ? "" : "es"}</div>
          <div className="mt-1 text-[34px] font-semibold leading-none">
            <Pct value={data.overall} threshold={data.threshold} />
          </div>
          <div className="mt-3">
            <PctBar value={data.overall} threshold={data.threshold} />
          </div>
          <div className="mt-3 text-[13px]">
            {below.length ? (
              <span className="font-medium text-gold-strong">
                {below.length} student{below.length === 1 ? "" : "s"} below {data.threshold}%
              </span>
            ) : data.recordedClasses ? (
              <span className="text-muted">Everyone is at or above {data.threshold}%.</span>
            ) : (
              <span className="text-muted">Numbers appear once classes are started or joined here.</span>
            )}
          </div>
        </div>
        <div className="min-w-0">
          {today && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-soft px-4 py-3 text-[14px]">
              <span>
                <span className="font-medium">Today, {formatTime(today.startTime)}</span>{" "}
                <span className="text-gold-strong">{today.state === "live" ? `On now. ${today.present + today.late} of ${today.total} joined.` : "Coming up."}</span>
              </span>
              <span className="flex items-center gap-2">
                {data.canManage && today.state !== "ended" && <StartClassButton action={startHref(uni, batch.id, today.date)} startTime={today.startTime} />}
                <Link className={buttonClass("secondary", "sm")} href={registerHref(uni, batch.id, today.date, today.startTime)}>
                  Open register
                </Link>
              </span>
            </div>
          )}
          {recent.length === 0 ? (
            <p className="text-[14px] text-muted">No classes held yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((s) => (
                <li key={s.key} className="flex items-center gap-4 py-2.5 text-[14px]">
                  <Link href={registerHref(uni, batch.id, s.date, s.startTime)} className="min-w-0 flex-1 truncate hover:text-brand">
                    {relativeDay(s.date, data.today)}, {formatTime(s.startTime)}
                  </Link>
                  <span className="w-28 shrink-0">
                    {s.counts ? (
                      <PctBar value={s.percent} threshold={data.threshold} />
                    ) : s.state === "live" ? (
                      <span className="text-[12px] text-gold-strong">On now</span>
                    ) : (
                      <span className="text-[12px] text-faint">Not recorded</span>
                    )}
                  </span>
                  <span className="tabular w-20 shrink-0 text-right text-[13px] text-muted">
                    {s.counts ? `${s.present + s.late}/${s.total}` : ""}
                  </span>
                  {s.live?.lockedAt && <Badge>Locked</Badge>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Link href={attendanceHref(uni, batch.id)} className="text-[14px] font-medium text-brand hover:underline">
              See every class and student
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────── Course tab ─────────────── */

export async function CourseLiveTab({ uni, actor, course }: CourseTabProps) {
  const data = await courseLive(actor, course.id);
  if (data.batches.length === 0) return <Empty title="No batches you can see">Live classes follow each batch&apos;s timetable. Add a batch first.</Empty>;
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-[14px] text-muted">
        Live classes follow each batch&apos;s timetable. Students join with the Join button on their timetable; it opens 15 minutes before the start, and joining
        more than 10 minutes late marks them late.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.batches.map((b) => (
          <Card key={b.batch.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/${uni}/admin/products/batches/${b.batch.id}`} className="text-[16px] font-semibold hover:text-brand">
                  {b.batch.name}
                </Link>
                <div className="text-[13px] text-muted">
                  {b.students} student{b.students === 1 ? "" : "s"}
                  {b.batch.status !== "open" && `, ${b.batch.status}`}
                </div>
              </div>
              <div className="text-right">
                <Pct value={b.overall} threshold={data.threshold} className="text-[20px]" />
                <div className="text-[12px] text-muted">{b.recordedClasses ? `${b.recordedClasses} classes recorded` : "attendance"}</div>
              </div>
            </div>
            <div className="mt-3">
              <PctBar value={b.overall} threshold={data.threshold} />
            </div>
            {b.below > 0 && (
              <div className="mt-2 text-[13px] font-medium text-gold-strong">
                {b.below} below {data.threshold}%
              </div>
            )}
            <div className="mt-4 text-[13px]">
              <span className="text-muted">Class link: </span>
              {b.meetingUrl ? (
                <a href={b.meetingUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  <LinkText url={b.meetingUrl} />
                </a>
              ) : (
                <span className="text-gold-strong">Not added. Add it on the batch page so students can join.</span>
              )}
            </div>
            <ul className="mt-3 flex-1 space-y-1.5 text-[14px]">
              {b.upcoming.length === 0 && <li className="text-muted">No upcoming classes in the next two weeks.</li>}
              {b.upcoming.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3">
                  <Link href={registerHref(uni, b.batch.id, s.date, s.startTime)} className="hover:text-brand">
                    {when(s, data.today)}
                  </Link>
                  <span className="flex items-center gap-2">
                    <KindNote s={s} />
                    {(s.state === "live" || s.state === "open") && <StateBadge state={s.state} />}
                    {s.link && s.link !== b.meetingUrl && <Badge>Own link</Badge>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-line pt-3">
              <Link href={attendanceHref(uni, b.batch.id)} className="text-[14px] font-medium text-brand hover:underline">
                Attendance for {b.batch.name}
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Dashboard card ─────────────── */

export async function AttendanceTodayCard({ uni, actor }: DashboardCardProps) {
  const { classes } = await todaysClasses(actor);
  return (
    <Card>
      <CardTitle hint={classes.length ? `${classes.length} class${classes.length === 1 ? "" : "es"}` : undefined}>Attendance today</CardTitle>
      {classes.length === 0 ? (
        <p className="text-[14px] text-muted">No live classes today in your batches.</p>
      ) : (
        <ul className="divide-y divide-line">
          {classes.map((s) => (
            <li key={s.key} className={cx("py-3", s.state === "ended" && "opacity-70")}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="tabular text-[13px] text-muted">
                      {formatTime(s.startTime)} to {formatTime(s.endTime)}
                    </span>
                    {(s.state === "live" || s.state === "open") && <StateBadge state={s.state} />}
                    {s.live?.lockedAt && <Badge>Locked</Badge>}
                  </div>
                  <Link href={registerHref(uni, s.batchId, s.date, s.startTime)} className="text-[14px] font-medium hover:text-brand">
                    {s.courseTitle}, {s.batchName}
                  </Link>
                </div>
                <div className="tabular shrink-0 text-right text-[14px]">
                  {s.state === "upcoming" ? (
                    <span className="text-muted">{s.total} expected</span>
                  ) : s.state === "ended" && !s.recorded ? (
                    <span className="text-faint">Not recorded</span>
                  ) : (
                    <>
                      <span className="font-semibold">{s.present + s.late}</span>
                      <span className="text-muted"> of {s.total} {s.state === "ended" ? "attended" : "joined"}</span>
                    </>
                  )}
                </div>
              </div>
              {((s.canStart && s.link) || (s.canMark && s.state !== "upcoming")) && (
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {s.canStart && s.link && <StartClassButton action={startHref(uni, s.batchId, s.date)} startTime={s.startTime} />}
                  {s.canMark && s.state !== "upcoming" && (
                    <Link href={registerHref(uni, s.batchId, s.date, s.startTime)} className={buttonClass("secondary", "sm")}>
                      {s.live?.lockedAt ? "View register" : "Take attendance"}
                    </Link>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
