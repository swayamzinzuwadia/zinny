import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardData } from "@/server/services/dashboard";
import { formatDate, formatTime } from "@/server/lib/dates";
import { cx } from "./ui";

const LANE_H = 76;

function hourLabel(h: number) {
  if (h === 12) return "12 pm";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * The dashboard's one moment: today as a bell schedule on a chalkboard. The title is the
 * date; each class is a block on the day's timeline and the gold line is now. With no class
 * today it folds to a single line. Accounts staff, who don't see batches, get the month's
 * collections on the same board instead. `actions` sit at the board's top right.
 */
export function TodayBoard({ data, base, actions }: { data: DashboardData; base: string; actions?: ReactNode }) {
  const empty = data.canSeeBatches && data.board.length === 0;
  const header = (
    <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-6 pt-6 sm:px-8">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight">{data.todayLabel}</h1>
        {empty && (
          <p className="mt-1 text-[14px] text-canvas/70">
            {data.nextDay
              ? `No classes today. Next up: ${data.nextDay.count} class${data.nextDay.count === 1 ? "" : "es"} on ${data.nextDay.label}.`
              : "No classes today."}
          </p>
        )}
      </div>
      {actions}
    </div>
  );

  return (
    <section className="relative overflow-hidden rounded-[var(--radius-board)] bg-brand-deep text-canvas">
      {/* chalk texture: a faint grid of rules, like an exercise book on a board */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
      />
      {header}
      {data.canSeeBatches ? (
        empty ? (
          <div className="h-6" />
        ) : (
          <Timeline data={data} base={base} />
        )
      ) : data.money ? (
        <MoneyStrip money={data.money} />
      ) : (
        <div className="h-6" />
      )}
    </section>
  );
}

function Timeline({ data, base }: { data: DashboardData; base: string }) {
  // Fit the rail to the day's classes (with an hour either side), but never less than 8 hours.
  const starts = data.board.map((s) => Math.floor(Number(s.startTime.slice(0, 2))));
  const ends = data.board.map((s) => Math.ceil(Number(s.endTime.slice(0, 2)) + Number(s.endTime.slice(3, 5)) / 60));
  let from = Math.max(0, Math.min(...starts) - 1);
  let to = Math.min(24, Math.max(...ends) + 1);
  while (to - from < 8) {
    if (from > 6) from--;
    if (to - from < 8 && to < 23) to++;
  }
  const span = (to - from) * 60;
  const pct = (min: number) => `${((min - from * 60) / span) * 100}%`;
  const lanes = Math.max(1, ...data.board.map((s) => s.lane + 1));
  const nowVisible = data.nowMin >= from * 60 && data.nowMin <= to * 60;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

  return (
    <div className="relative mt-5 overflow-x-auto px-6 pb-6 sm:px-8">
      {/* Fits a tablet beside the sidebar; only phones scroll the day sideways. */}
      <div className="relative min-w-[560px]">
        {/* hour rail */}
        <div className="relative h-5 text-[12px] text-canvas/50">
          {hours.map((h, i) =>
            i % 2 === 0 || hours.length <= 10 ? (
              <span
                key={h}
                className={cx("tabular absolute whitespace-nowrap", i === 0 ? "" : i === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
                style={{ left: pct(h * 60) }}
              >
                {hourLabel(h)}
              </span>
            ) : null,
          )}
        </div>
        <div className="relative" style={{ height: lanes * LANE_H + 8 }}>
          {hours.map((h) => (
            <div key={h} className="absolute bottom-0 top-0 w-px bg-canvas/10" style={{ left: pct(h * 60) }} />
          ))}

          {data.board.map((s, i) => {
            const left = pct(toMin(s.startTime));
            const width = `calc(${((toMin(s.endTime) - toMin(s.startTime)) / span) * 100}% - 6px)`;
            return (
              <Link
                key={i}
                href={`${base}/products/batches/${s.batchId}`}
                className={cx(
                  "absolute rounded-xl px-3 py-2 text-[13px] leading-snug transition-colors",
                  s.state === "live" && "bg-gold text-brand-deep",
                  s.state === "next" && "border border-canvas/40 bg-canvas/[0.12] hover:bg-canvas/[0.18]",
                  s.state === "later" && "border border-canvas/15 bg-canvas/[0.08] hover:bg-canvas/[0.14]",
                  s.state === "past" && "bg-canvas/[0.05] text-canvas/45",
                )}
                style={{ left, width, top: 6 + s.lane * LANE_H, height: LANE_H - 8 }}
              >
                {s.state === "live" && (
                  <span className="absolute -top-2.5 left-3 rounded-full bg-brand-deep px-2 py-px text-[11px] font-medium text-gold">Now</span>
                )}
                <div className="truncate font-medium">{s.courseTitle}</div>
                <div className={cx("tabular truncate", s.state === "live" ? "text-brand-deep/75" : "text-canvas/65", s.state === "past" && "text-canvas/35")}>
                  {formatTime(s.startTime)}–{formatTime(s.endTime)}
                </div>
                <div className={cx("truncate", s.state === "live" ? "text-brand-deep/75" : "text-canvas/65", s.state === "past" && "text-canvas/35")}>
                  {s.batchName}, {s.students} student{s.students === 1 ? "" : "s"}
                </div>
              </Link>
            );
          })}

          {nowVisible && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10" style={{ left: pct(data.nowMin) }}>
              <div className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-gold" />
              <div className="now-dot absolute -top-1.5 h-3 w-3 -translate-x-1/2 rounded-full bg-gold" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MoneyStrip({ money }: { money: NonNullable<DashboardData["money"]> }) {
  const max = Math.max(1, ...money.days.map((d) => d.paise));
  return (
    <div className="relative mt-5 grid gap-8 px-6 pb-6 sm:grid-cols-[auto_1fr] sm:px-8">
      <div>
        <div className="text-[13px] text-canvas/65">Collected this month</div>
        <div className="tabular mt-1.5 text-[32px] font-medium leading-none">{rupees(money.monthPaise)}</div>
        <div className="mt-2 text-[13px] text-canvas/65">{money.monthOrders} paid orders</div>
      </div>
      <div>
        <div className="flex h-20 items-end gap-1.5" role="img" aria-label="Collections over the last 14 days">
          {money.days.map((d, i) => (
            <div
              key={d.date}
              className={cx("flex-1 rounded-md", i === money.days.length - 1 ? "bg-gold" : "bg-canvas/25")}
              style={{ height: `${Math.max(4, (d.paise / max) * 80)}px` }}
              title={`${formatDate(d.date)}: ${rupees(d.paise)}`}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-canvas/55">
          <span>{formatDate(money.days[0].date, { year: false })}</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
