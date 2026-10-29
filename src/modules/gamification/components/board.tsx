import Link from "next/link";
import { Avatar, Badge, cx } from "@/components/ui";
import { PERIODS, type Period } from "../catalog";

export type RankRow = { userId: string; name: string; points: number; rank: number };

/** Leaderboard rows: rank, name, XP and a bar against the leader. The viewer's own row is marked. */
export function RankList({
  rows,
  me,
  limit,
  avatars = true,
  emptyText = "No students here yet.",
}: {
  rows: RankRow[];
  me?: string;
  /** Show the first `limit` rows, plus the viewer's own row if it falls below. */
  limit?: number;
  avatars?: boolean;
  emptyText?: string;
}) {
  if (rows.length === 0) return <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">{emptyText}</p>;
  const top = rows[0]?.points || 0;
  const shown = limit && rows.length > limit ? rows.filter((r, i) => i < limit || r.userId === me) : rows;
  return (
    <ol className="divide-y divide-line">
      {shown.map((r, i) => {
        const mine = r.userId === me;
        const gap = i > 0 && shown[i - 1] !== rows[rows.indexOf(r) - 1];
        return (
          <li key={r.userId} className={cx("flex items-center gap-3 px-2 py-2.5 sm:px-3", mine && "rounded-xl bg-brand-soft", gap && "border-t-2 border-dashed")}>
            <span
              className={cx(
                "tabular inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-[13px] font-semibold",
                r.rank <= 3 && r.points > 0 ? "bg-brand text-canvas" : "bg-canvas text-muted ring-1 ring-line",
              )}
              aria-label={`Rank ${r.rank}`}
            >
              {r.rank}
            </span>
            {avatars && <Avatar name={r.name} size={30} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cx("truncate text-[14px]", mine ? "font-semibold text-ink" : "font-medium")}>{r.name}</span>
                {mine && <Badge tone="brand">You</Badge>}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/70" aria-hidden>
                <div className="h-full rounded-full bg-brand" style={{ width: top ? `${Math.max(2, (r.points / top) * 100)}%` : "0%" }} />
              </div>
            </div>
            <span className="tabular w-16 shrink-0 text-right text-[14px] font-semibold">
              {r.points.toLocaleString("en-IN")}
              <span className="ml-0.5 text-[12px] font-normal text-muted">XP</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "This week · This month · All time" as links that keep the other query parameters. */
export function PeriodSwitch({ active, href }: { active: Period; href: (p: Period) => string }) {
  return (
    <nav className="inline-flex gap-1 rounded-full border border-line bg-surface p-1" aria-label="Period">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={href(p.key)}
          aria-current={p.key === active ? "page" : undefined}
          className={cx(
            "whitespace-nowrap rounded-full px-3.5 py-1 text-[13px]",
            p.key === active ? "bg-brand font-medium text-canvas" : "text-muted hover:text-ink",
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

/** A thin progress bar towards a target. */
export function ProgressBar({ value, target, label }: { value: number; target: number; label: string }) {
  const pct = Math.min(100, target ? (value / target) * 100 : 0);
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-line/70"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={Math.min(value, target)}
    >
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Small stat for the cream panels on learner screens. */
export function MiniStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="tabular text-[22px] font-semibold leading-tight">{value}</div>
      {hint && <div className="truncate text-[12px] text-muted">{hint}</div>}
    </div>
  );
}
