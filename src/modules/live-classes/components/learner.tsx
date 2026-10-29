/**
 * Learner screens (mobile first): the course hub's Live classes tab and the home card.
 * Join buttons are plain <a> links, never <Link>: the join route records attendance.
 */
import Link from "next/link";
import type { HomeCardProps, LearnerCourseTabProps } from "@/contracts/module";
import { buttonClass, Card, CardTitle, cx, Empty, Notice } from "@/components/ui";
import { joinNext, learnerLive } from "../join";
import { joinHref, learnerTabHref } from "../links";
import { clockIn, formatTime, relativeDay, startsIn } from "../time";
import { KindNote, Pct, PctBar, StatusBadge, when } from "./bits";
import { WindowRail } from "./window-rail";

export async function LearnerLiveTab({ uni, actor, enrolment }: LearnerCourseTabProps) {
  const now = new Date();
  const data = await learnerLive(actor, enrolment.enrolmentId, now);
  const below = data.percent !== null && data.percent < data.threshold;
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] text-muted">Your attendance</div>
            <div className="mt-0.5 text-[30px] font-semibold leading-none">
              <Pct value={data.percent} threshold={data.threshold} />
            </div>
          </div>
          <div className="text-right text-[13px] text-muted">
            {data.held ? `${data.attended} of ${data.held} classes` : "Counted once your classes start"}
            <div>Minimum {data.threshold}%</div>
          </div>
        </div>
        <div className="mt-4">
          <PctBar value={data.percent} threshold={data.threshold} />
        </div>
        {below && (
          <div className="mt-4">
            <Notice tone="gold">
              You&apos;re below the {data.threshold}% minimum. Join the next classes on time to bring it up, or talk to your faculty if something is stopping you.
            </Notice>
          </div>
        )}
      </Card>

      {data.active && (
        <section>
          <h2 className="mb-3 text-[17px] font-medium">Upcoming classes</h2>
          {data.upcoming.length === 0 ? (
            <Empty title="No classes in the next two weeks">They&apos;ll show up here as soon as they&apos;re on the timetable.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {data.upcoming.map((s) => (
                <li
                  key={`${s.date}${s.startTime}`}
                  className={cx(
                    "rounded-[18px] border bg-surface px-4 py-3.5",
                    s.joinable ? "border-gold ring-2 ring-gold-soft" : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{when(s, data.today)}</div>
                      <div className="text-[13px] text-muted">
                        {s.state === "live" ? `On now, until ${formatTime(s.endTime)}` : s.joinable ? "Join is open" : `Join opens at ${clockIn(s.window.opensAt, data.tz)}`}
                      </div>
                      <KindNote s={s} />
                    </div>
                    {s.joinable && s.hasLink ? (
                      <a href={joinHref(uni, s.batchId, s.date, s.startTime)} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
                        Join class
                      </a>
                    ) : !s.hasLink ? (
                      <span className="text-[13px] text-muted">Link not added yet</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[17px] font-medium">Past classes</h2>
        {data.past.length === 0 ? (
          <p className="text-[14px] text-muted">Classes you&apos;ve had will appear here with your attendance and the recording.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[22px] border border-line bg-surface">
            {data.past.map((p) => (
              <li key={`${p.batchId}${p.date}${p.startTime}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium">
                    {relativeDay(p.date, data.today)}, {formatTime(p.startTime)}
                  </div>
                  <div className="text-[13px] text-muted">
                    {p.joinedAt ? `Joined at ${clockIn(p.joinedAt, data.tz)}` : p.status === "absent" ? "You didn't join" : p.status ? "Marked by your faculty" : "Not recorded"}
                    {p.note && <span>. Note: {p.note}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {p.recordingUrl && (
                    <a href={p.recordingUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-brand hover:underline">
                      Watch recording
                    </a>
                  )}
                  <StatusBadge status={p.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export async function JoinNextCard({ uni, actor }: HomeCardProps) {
  const now = new Date();
  const next = await joinNext(actor, now);
  if (!next) return null;
  const s = next.session;
  const live = s.state === "live";
  const headline = live
    ? `On now, until ${formatTime(s.endTime)}`
    : `${relativeDay(s.date, next.today)} at ${formatTime(s.startTime)}, ${startsIn(s.window.startsAt.getTime() - now.getTime())}`;
  return (
    <Card className={cx("p-5", next.joinable && "border-gold ring-2 ring-gold-soft")}>
      <CardTitle hint={s.batchName}>{live ? "Your class is on" : "Next live class"}</CardTitle>
      <div className="text-[20px] font-semibold leading-tight">{next.courseTitle}</div>
      <div className="mt-1 text-[14px] text-muted">{headline}</div>
      <div className="mt-4">
        <WindowRail window={s.window} tz={next.tz} now={now} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {next.joinable && next.hasLink ? (
          <a href={joinHref(uni, s.batchId, s.date, s.startTime)} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
            {next.joinedAt ? "Rejoin class" : "Join class"}
          </a>
        ) : (
          <span className="text-[14px] text-muted">
            {!next.hasLink ? "Your faculty hasn't added the class link yet." : `Join opens at ${clockIn(s.window.opensAt, next.tz)}.`}
          </span>
        )}
        {next.joinedAt && <span className="text-[13px] text-muted">You joined at {clockIn(next.joinedAt, next.tz)}</span>}
        <Link href={learnerTabHref(uni, next.enrolmentId)} className="text-[13px] text-brand hover:underline">
          Your attendance
        </Link>
      </div>
    </Card>
  );
}
