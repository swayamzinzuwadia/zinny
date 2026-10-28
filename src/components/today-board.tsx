import Link from "next/link";
import type { DashboardData } from "@/server/services/dashboard";
import { formatDate, formatTime } from "@/server/lib/dates";
import { formatINR } from "@/server/services/finance";
import { cx } from "./ui";

const LANE_H = 106;

function hourLabel(h: number) {
  if (h === 12) return "12 pm";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

/**
 * The dashboard's hero: today as a bell schedule on a chalkboard. Each class is a block
 * on the day's timeline; the gold line is now. Accounts staff, who don't see batches,
 * get the month's collections on the same board instead.
 */
export function TodayBoard({
  data,
  firstName,
  base,
  summary,
}: {
  data: DashboardData;
  firstName: string;
  base: string;
  summary: string[];
}) {
  // Fit the rail to the day's classes (with an hour either side), but never less than 8 hours.
  const starts = data.board.map((s) => Math.floor(Number(s.startTime.slice(0, 2))));
  const ends = data.board.map((s) => Math.ceil(Number(s.endTime.slice(0, 2)) + Number(s.endTime.slice(3, 5)) / 60));
  let from = data.board.length ? Math.max(0, Math.min(...starts) - 1) : 8;
  let to = data.board.length ? Math.min(24, Math.max(...ends) + 1) : 20;
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
    <section className="relative overflow-hidden rounded-[var(--radius-board)] bg-brand-deep text-canvas">
      {/* chalk texture: a faint grid of rules, like an exercise book on a board */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
      />
      <div className="relative flex flex-wrap items-end justify-between gap-6 px-7 pt-7 sm:px-9 sm:pt-9">
        <div>
          <div className="text-[14px] text-canvas/65">{data.todayLabel}</div>
          <h1 className="mt-1 text-[36px] font-semibold leading-[1.1] sm:text-[44px]">
            {data.greeting}, {firstName}
          </h1>
        </div>
        <ul className="space-y-1.5 text-[14px] text-canvas/85">
          {summary.map((s) => (
            <li key={s} className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              {s}
            </li>
          ))}
        </ul>
      </div>

      {data.canSeeBatches ? (
        <div className="relative mt-8 overflow-x-auto px-7 pb-8 sm:px-9">
          <div className="relative min-w-[760px]">
            {/* hour rail */}
            <div className="relative h-6 text-[12px] text-canvas/50">
              {hours.map((h, i) =>
                i % 2 === 0 || hours.length <= 10 ? (
                  <span
                    key={h}
                    className={cx(
                      "tabular absolute whitespace-nowrap",
                      i === 0 ? "" : i === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                    )}
                    style={{ left: pct(h * 60) }}
                  >
                    {hourLabel(h)}
                  </span>
                ) : null,
              )}
            </div>
            <div className="relative" style={{ height: lanes * LANE_H + 16 }}>
              {hours.map((h) => (
                <div key={h} className="absolute bottom-0 top-0 w-px bg-canvas/10" style={{ left: pct(h * 60) }} />
              ))}

              {data.board.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-center text-[15px] text-canvas/70">
                  {data.nextDay ? (
                    <span>
                      No classes today. Next up: {data.nextDay.count} class{data.nextDay.count === 1 ? "" : "es"} on {data.nextDay.label}.
                    </span>
                  ) : (
                    <span>No classes scheduled.</span>
                  )}
                </div>
              )}

              {data.board.map((s, i) => {
                const left = pct(toMin(s.startTime));
                const width = `calc(${((toMin(s.endTime) - toMin(s.startTime)) / span) * 100}% - 6px)`;
                return (
                  <Link
                    key={i}
                    href={`${base}/products/batches/${s.batchId}`}
                    className={cx(
                      "absolute rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug transition-colors",
                      s.state === "live" && "bg-gold text-brand-deep",
                      s.state === "next" && "border border-gold/70 bg-canvas/[0.12] hover:bg-canvas/[0.18]",
                      s.state === "later" && "border border-canvas/15 bg-canvas/[0.08] hover:bg-canvas/[0.14]",
                      s.state === "past" && "bg-canvas/[0.05] text-canvas/45",
                    )}
                    style={{ left, width, top: 8 + s.lane * LANE_H, height: LANE_H - 10 }}
                  >
                    {(s.state === "live" || s.state === "next") && (
                      <span
                        className={cx(
                          "absolute -top-2.5 right-3 rounded-full px-2 py-px text-[11px] font-medium",
                          s.state === "live" ? "bg-brand-deep text-gold" : "bg-gold text-brand-deep",
                        )}
                      >
                        {s.state === "live" ? "Now" : "Next"}
                      </span>
                    )}
                    <div className="tabular truncate opacity-80">
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                    </div>
                    <div className="line-clamp-2 font-medium">{s.courseTitle}</div>
                    <div
                      className={cx(
                        "truncate",
                        s.state === "live" ? "text-brand-deep/75" : "text-canvas/60",
                        s.state === "past" && "text-canvas/35",
                      )}
                    >
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
      ) : data.money ? (
        <MoneyStrip money={data.money} />
      ) : (
        <div className="h-8" />
      )}
    </section>
  );
}

function MoneyStrip({ money }: { money: NonNullable<DashboardData["money"]> }) {
  const max = Math.max(1, ...money.days.map((d) => d.paise));
  return (
    <div className="relative mt-8 grid gap-8 px-7 pb-8 sm:grid-cols-[auto_1fr] sm:px-9">
      <div>
        <div className="text-[13px] text-canvas/65">Collected this month</div>
        <div className="tabular mt-1 text-[40px] font-semibold leading-none">{formatINR(money.monthPaise)}</div>
        <div className="mt-2 text-[13px] text-canvas/65">{money.monthOrders} paid orders</div>
      </div>
      <div>
        <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Collections over the last 14 days">
          {money.days.map((d, i) => (
            <div
              key={d.date}
              className={cx("flex-1 rounded-md", i === money.days.length - 1 ? "bg-gold" : "bg-canvas/25")}
              style={{ height: `${Math.max(4, (d.paise / max) * 112)}px` }}
              title={`${formatDate(d.date)}: ${formatINR(d.paise)}`}
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
