import type { Session } from "@/server/services/schedule";
import { addDays, formatTime, isoWeekday, weekdayLabel } from "@/server/lib/dates";
import { cx } from "./ui";

/** Brand green and gold first, then two quiet companions that sit well on cream. */
const PALETTE = [
  "bg-brand text-canvas border-brand",
  "bg-gold-soft text-gold-strong border-gold/40",
  "bg-[#e6ebf3] text-[#2f4a72] border-[#2f4a72]/15",
  "bg-[#f1e6ee] text-[#7a3d66] border-[#7a3d66]/15",
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
            <div key={d} className={cx("rounded-[18px] border p-2", isToday ? "border-gold bg-surface ring-2 ring-gold-soft" : "border-line bg-surface/70")}>
              <div className={cx("mb-2 px-1 text-[13px] font-medium", isToday ? "text-gold-strong" : "text-muted")}>
                {weekdayLabel(isoWeekday(d))} <span className="font-normal">{Number(d.slice(8))}</span>
              </div>
              <div className="space-y-1.5">
                {items.length === 0 && <div className="px-1 text-xs text-faint sm:h-8">—</div>}
                {items.map((s, i) => (
                  <div key={i} className={cx("rounded-[12px] border px-2.5 py-2 text-[12px] leading-snug", color(s.courseId))}>
                    <div className="tabular opacity-85">
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                    </div>
                    <div className="font-medium">{s.courseTitle}</div>
                    {!compact && <div className="opacity-80">{s.batchName}</div>}
                    {s.kind !== "regular" && <div className="mt-0.5 text-[11px] opacity-80">{s.kind === "extra" ? "Extra class" : "Moved here"}</div>}
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
