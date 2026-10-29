/**
 * The class window as one bar in three stretches: join opens (early), on time, late, with
 * the gold "now" dot while the window is open. It shows students the rule instead of
 * explaining it: join before the late mark and you're present.
 */
import { cx } from "@/components/ui";
import type { SessionWindow } from "../time";
import { clockIn, LATE_AFTER_MINUTES } from "../time";

// Not to scale: the first two stretches are short, so each gets a fixed share of the bar.
const EARLY = 30;
const ON_TIME = 30;

function position(w: SessionWindow, at: Date): number {
  const t = at.getTime();
  const late = w.startsAt.getTime() + LATE_AFTER_MINUTES * 60_000;
  const lerp = (a: number, b: number, from: number, to: number) => from + ((t - a) / Math.max(1, b - a)) * (to - from);
  if (t <= w.opensAt.getTime()) return 0;
  if (t <= w.startsAt.getTime()) return lerp(w.opensAt.getTime(), w.startsAt.getTime(), 0, EARLY);
  if (t <= late) return lerp(w.startsAt.getTime(), late, EARLY, EARLY + ON_TIME);
  if (t <= w.endsAt.getTime()) return lerp(late, w.endsAt.getTime(), EARLY + ON_TIME, 100);
  return 100;
}

export function WindowRail({ window: w, tz, now, tone = "light" }: { window: SessionWindow; tz: string; now: Date; tone?: "light" | "dark" }) {
  const late = new Date(w.startsAt.getTime() + LATE_AFTER_MINUTES * 60_000);
  const inside = now.getTime() >= w.opensAt.getTime() && now.getTime() < w.endsAt.getTime();
  const dark = tone === "dark";
  const time = cx("tabular font-medium", dark ? "text-canvas" : "text-ink");
  const label = dark ? "text-canvas/60" : "text-muted";
  return (
    <div
      className="pt-2"
      role="img"
      aria-label={`Join from ${clockIn(w.opensAt, tz)}. Starts ${clockIn(w.startsAt, tz)}. Late after ${clockIn(late, tz)}. Ends ${clockIn(w.endsAt, tz)}.`}
    >
      <div className="relative flex h-2 gap-[2px]">
        <div className={cx("rounded-l-full", dark ? "bg-canvas/35" : "bg-brand/35")} style={{ width: `${EARLY}%` }} />
        <div className={dark ? "bg-canvas/75" : "bg-brand"} style={{ width: `${ON_TIME}%` }} />
        <div className={cx("flex-1 rounded-r-full", dark ? "bg-gold/45" : "bg-gold-soft")} />
        {inside && (
          <span
            className="now-dot absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold ring-2 ring-surface"
            style={{ left: `${position(w, now)}%` }}
          />
        )}
      </div>
      <div className="mt-2 flex text-[12px] leading-tight" aria-hidden>
        <div style={{ width: `${EARLY}%` }} className="pr-1">
          <div className={time}>{clockIn(w.opensAt, tz)}</div>
          <div className={label}>Join opens</div>
        </div>
        <div style={{ width: `${ON_TIME}%` }} className="pr-1">
          <div className={time}>{clockIn(w.startsAt, tz)}</div>
          <div className={label}>Starts</div>
        </div>
        <div className="flex flex-1 justify-between gap-2">
          <div>
            <div className={time}>{clockIn(late, tz)}</div>
            <div className={label}>Late after</div>
          </div>
          <div className="text-right">
            <div className={time}>{clockIn(w.endsAt, tz)}</div>
            <div className={label}>Ends</div>
          </div>
        </div>
      </div>
    </div>
  );
}
