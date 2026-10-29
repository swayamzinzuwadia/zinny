/**
 * The class window as one line: join opens, class starts, late after, class ends, with the
 * gold "now" dot while the window is open. It shows students the rules instead of
 * explaining them: join before the late mark and you're present.
 */
import { cx } from "@/components/ui";
import type { SessionWindow } from "../time";
import { clockIn, LATE_AFTER_MINUTES } from "../time";

// Not to scale: the first two stretches are short, so they get fixed shares of the line.
const SHARE = { open: 22, onTime: 22 };

function position(w: SessionWindow, at: Date): number {
  const t = at.getTime();
  const late = w.startsAt.getTime() + LATE_AFTER_MINUTES * 60_000;
  const lerp = (a: number, b: number, from: number, to: number) => from + ((t - a) / Math.max(1, b - a)) * (to - from);
  if (t <= w.opensAt.getTime()) return 0;
  if (t <= w.startsAt.getTime()) return lerp(w.opensAt.getTime(), w.startsAt.getTime(), 0, SHARE.open);
  if (t <= late) return lerp(w.startsAt.getTime(), late, SHARE.open, SHARE.open + SHARE.onTime);
  if (t <= w.endsAt.getTime()) return lerp(late, w.endsAt.getTime(), SHARE.open + SHARE.onTime, 100);
  return 100;
}

export function WindowRail({ window: w, tz, now, tone = "light" }: { window: SessionWindow; tz: string; now: Date; tone?: "light" | "dark" }) {
  const late = new Date(w.startsAt.getTime() + LATE_AFTER_MINUTES * 60_000);
  const inside = now.getTime() >= w.opensAt.getTime() && now.getTime() < w.endsAt.getTime();
  const dark = tone === "dark";
  const ticks = [
    { at: 0, time: clockIn(w.opensAt, tz), label: "Join opens", align: "left" as const },
    { at: SHARE.open, time: clockIn(w.startsAt, tz), label: "Starts", align: "center" as const },
    { at: SHARE.open + SHARE.onTime, time: clockIn(late, tz), label: "Late after", align: "center" as const },
    { at: 100, time: clockIn(w.endsAt, tz), label: "Ends", align: "right" as const },
  ];
  return (
    <div className="pt-2" role="img" aria-label={`Join from ${ticks[0].time}. Starts ${ticks[1].time}. Late after ${ticks[2].time}. Ends ${ticks[3].time}.`}>
      <div className="relative h-2">
        <div className={cx("absolute inset-0 rounded-full", dark ? "bg-canvas/15" : "bg-line")} />
        <div className={cx("absolute inset-y-0 left-0 rounded-l-full", dark ? "bg-canvas/35" : "bg-brand/35")} style={{ width: `${SHARE.open}%` }} />
        <div className={cx("absolute inset-y-0", dark ? "bg-canvas/70" : "bg-brand")} style={{ left: `${SHARE.open}%`, width: `${SHARE.onTime}%` }} />
        <div className={cx("absolute inset-y-0 right-0 rounded-r-full", dark ? "bg-gold/40" : "bg-gold-soft")} style={{ left: `${SHARE.open + SHARE.onTime}%` }} />
        {inside && (
          <span
            className="now-dot absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold ring-2 ring-surface"
            style={{ left: `${position(w, now)}%` }}
          />
        )}
      </div>
      <div className="relative mt-2 h-9 text-[12px] leading-tight">
        {ticks.map((t) => (
          <div
            key={t.label}
            className={cx(
              "absolute whitespace-nowrap",
              t.align === "center" && "-translate-x-1/2 text-center",
              t.align === "right" && "-translate-x-full text-right",
            )}
            style={{ left: `${t.at}%` }}
          >
            <div className={cx("tabular font-medium", dark ? "text-canvas" : "text-ink")}>{t.time}</div>
            <div className={dark ? "text-canvas/60" : "text-muted"}>{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
