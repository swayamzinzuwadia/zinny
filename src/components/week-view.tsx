import type { Session } from "@/server/services/schedule";
import { addDays, formatTime, isoWeekday, weekdayLabel } from "@/server/lib/dates";
import { cx } from "./ui";

const PALETTE = [
  "bg-brand-soft text-brand-strong border-brand/20",
  "bg-[#eef1fb] text-[#2f437f] border-[#2f437f]/15",
  "bg-[#fbf1e8] text-[#7a4416] border-[#7a4416]/15",
  "bg-[#f3eefa] text-[#5b3a86] border-[#5b3a86]/15",
];

/** Week grid like PRD page 6: one column per day, today highlighted. */
export function WeekView({ from, today, sessions, compact = false }: { from: string; today: string; sessions: Session[]; compact?: boolean }) {
  const courseIds = [...new Set(sessions.map((s) => s.courseId))];
  const color = (id: string) => PALETTE[courseIds.indexOf(id) % PALETTE.length];
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((d) => {
          const items = sessions.filter((s) => s.date === d);
          const isToday = d === today;
          return (
            <div key={d} className={cx("rounded-2xl border p-2", isToday ? "border-brand bg-surface" : "border-line bg-surface/60")}>
              <div className={cx("mb-2 px-1 text-[13px] font-semibold", isToday ? "text-brand" : "text-muted")}>
                {weekdayLabel(isoWeekday(d))} <span className="font-normal">{Number(d.slice(8))}</span>
              </div>
              <div className="space-y-1.5">
                {items.length === 0 && <div className="px-1 text-xs text-faint sm:h-8">—</div>}
                {items.map((s, i) => (
                  <div key={i} className={cx("rounded-xl border px-2 py-1.5 text-[12px] leading-snug", color(s.courseId))}>
                    <div className="font-medium tabular-nums">
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                    </div>
                    <div className="font-semibold">{s.courseTitle}</div>
                    {!compact && <div className="opacity-80">{s.batchName}</div>}
                    {s.kind !== "regular" && <div className="mt-0.5 text-[11px] uppercase tracking-wide opacity-80">{s.kind === "extra" ? "Extra class" : "Moved"}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {courseIds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
          {courseIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5">
              <span className={cx("h-2.5 w-2.5 rounded-full border", color(id))} />
              {sessions.find((s) => s.courseId === id)?.courseTitle}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
