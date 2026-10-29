/**
 * What the join route shows when it doesn't send the student straight to the class:
 * too early, ended, no link, cancelled, moved, no class that day, or not their batch.
 * Every state says when the class is and what to do next.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, Card, cx } from "@/components/ui";
import type { JoinOutcome } from "../join";
import { joinHref } from "../links";
import { clockIn, formatDay, formatTime, relativeDay } from "../time";
import { when } from "./bits";
import { JoinWhenOpen } from "./join-when-open";
import { WindowRail } from "./window-rail";

function Shell({ eyebrow, title, children, tone = "plain" }: { eyebrow: string; title: string; children: ReactNode; tone?: "plain" | "board" }) {
  const board = tone === "board";
  return (
    <section
      className={cx(
        "relative overflow-hidden rounded-[var(--radius-board)] p-6 sm:p-9",
        board ? "bg-brand-deep text-canvas" : "border border-line bg-surface",
      )}
    >
      {board && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
        />
      )}
      <div className="relative max-w-xl">
        <div className={cx("text-[14px]", board ? "text-canvas/65" : "text-muted")}>{eyebrow}</div>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight sm:text-[34px]">{title}</h1>
        <div className={cx("mt-4 space-y-5 text-[15px]", board ? "text-canvas/85" : "text-ink")}>{children}</div>
      </div>
    </section>
  );
}

export function JoinStatePage({ uni, out, batchId, now }: { uni: string; out: Exclude<JoinOutcome, { kind: "go" }>; batchId: string; now: Date }) {
  const timetable = `/${uni}/learn/timetable`;
  const back = (
    <Link href={timetable} className="text-[14px] underline-offset-4 hover:underline">
      Back to your timetable
    </Link>
  );

  if (out.kind === "not_in_batch") {
    return (
      <Shell eyebrow="Live class" title="This class isn't in your timetable">
        <p>You can join only the classes of the batch you&apos;re in. If you switched batch, join from your timetable, which shows your current batch.</p>
        <Link href={timetable} className={buttonClass("primary")}>
          Open your timetable
        </Link>
      </Shell>
    );
  }

  const eyebrow = `${out.ctx.courseTitle}, ${out.ctx.batchName}`;

  if (out.kind === "too_early") {
    const s = out.session;
    return (
      <Shell tone="board" eyebrow={eyebrow} title={`Your class starts ${relativeDay(s.date, out.ctx.today).toLowerCase()} at ${formatTime(s.startTime)}`}>
        <p>
          You can join from {clockIn(s.window.opensAt, out.ctx.tz)}
          {s.date !== out.ctx.today ? ` on ${formatDay(s.date)}` : ""}. Join by {clockIn(new Date(s.window.startsAt.getTime() + 10 * 60_000), out.ctx.tz)} to be
          marked present; after that you&apos;re marked late.
        </p>
        <div className="rounded-[22px] bg-canvas/[0.07] px-4 pb-2 pt-3">
          <WindowRail window={s.window} tz={out.ctx.tz} now={now} tone="dark" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <JoinWhenOpen href={joinHref(uni, batchId, s.date, s.startTime)} opensAt={s.window.opensAt.toISOString()} label={`Join opens at ${clockIn(s.window.opensAt, out.ctx.tz)}`} />
          <Link href={timetable} className="text-[14px] text-canvas/80 underline-offset-4 hover:underline">
            Back to your timetable
          </Link>
        </div>
      </Shell>
    );
  }

  if (out.kind === "ended") {
    const s = out.session;
    return (
      <Shell eyebrow={eyebrow} title={`This class ended at ${formatTime(s.endTime)}`}>
        <p>
          It ran {when(s, out.ctx.today).replace(/^\w/, (c) => c.toLowerCase())}.{" "}
          {out.recordingUrl ? "The recording is ready." : "If your faculty adds a recording, it will be on the course page."}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {out.recordingUrl && (
            <a href={out.recordingUrl} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
              Watch the recording
            </a>
          )}
          {back}
        </div>
      </Shell>
    );
  }

  if (out.kind === "no_link") {
    const s = out.session;
    return (
      <Shell eyebrow={eyebrow} title="The class link isn't ready yet">
        <p>
          Your class is {when(s, out.ctx.today).replace(/^\w/, (c) => c.toLowerCase())}, but your faculty hasn&apos;t added the meeting link. Try again in a minute; if it
          still isn&apos;t there, message your faculty. Your attendance is recorded when you join.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <a href={joinHref(uni, batchId, s.date, s.startTime)} className={buttonClass("primary")}>
            Try again
          </a>
          {back}
        </div>
      </Shell>
    );
  }

  if (out.kind === "cancelled") {
    return (
      <Shell eyebrow={eyebrow} title={`The class on ${formatDay(out.date)} is cancelled`}>
        <p>{out.note ? `Your faculty's note: ${out.note}.` : "There's nothing to join that day."} Your timetable shows your next classes.</p>
        <Link href={timetable} className={buttonClass("primary")}>
          Open your timetable
        </Link>
      </Shell>
    );
  }

  if (out.kind === "moved") {
    return (
      <Shell eyebrow={eyebrow} title={`This class moved to ${formatDay(out.to.date)}`}>
        <p>
          It&apos;s now on {formatDay(out.to.date)}, {formatTime(out.to.startTime)} to {formatTime(out.to.endTime)}.{out.note ? ` Your faculty's note: ${out.note}.` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <a href={joinHref(uni, batchId, out.to.date, out.to.startTime)} className={buttonClass("primary")}>
            Go to the new class
          </a>
          {back}
        </div>
      </Shell>
    );
  }

  // no_class
  return (
    <Shell eyebrow={eyebrow} title={`No class on ${formatDay(out.date)}`}>
      <p>
        {out.next
          ? `Your next class is ${when(out.next, out.ctx.today).replace(/^\w/, (c) => c.toLowerCase())}.`
          : "There are no more classes on this batch's timetable."}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {out.next && (
          <a href={joinHref(uni, batchId, out.next.date, out.next.startTime)} className={buttonClass("primary")}>
            Go to your next class
          </a>
        )}
        {back}
      </div>
    </Shell>
  );
}

export function NotAStudentPage({ uni }: { uni: string }) {
  return (
    <Card>
      <h1 className="text-[22px] font-semibold">Only current students can join live classes</h1>
      <p className="mt-2 text-[14px] text-muted">Join links work for students enrolled in the batch. Graduates and parents can see the timetable but not join.</p>
      <Link href={`/${uni}/learn`} className={cx(buttonClass("secondary"), "mt-4")}>
        Back to home
      </Link>
    </Card>
  );
}
