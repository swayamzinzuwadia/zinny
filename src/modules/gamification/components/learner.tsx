import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, CardTitle, cx } from "@/components/ui";
import { ordinal } from "../challenges";
import type { MyBadge, MyChallenge } from "../learner";
import { formatDay } from "../util";
import { BadgeIcon } from "./badge-icon";
import { ProgressBar } from "./board";

/** The learner's XP on the chalkboard: total, plus this week and this month. */
export function XpHero({ total, week, month, children }: { total: number; week: number; month: number; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-board)] bg-brand-deep p-6 text-canvas sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
      />
      <div className="relative">
        <div className="text-[14px] text-canvas/65">Your XP</div>
        <div className="tabular mt-1 text-[48px] font-semibold leading-none sm:text-[56px]">{total.toLocaleString("en-IN")}</div>
        <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
          <span className="tabular rounded-full bg-canvas/[0.09] px-3 py-1">+{week.toLocaleString("en-IN")} this week</span>
          <span className="tabular rounded-full bg-canvas/[0.09] px-3 py-1">+{month.toLocaleString("en-IN")} this month</span>
        </div>
        {children}
      </div>
    </section>
  );
}

/** Someone with no XP shares last place with everyone else at zero: don't call that a rank. */
const ranked = (b: { rank: number | null; points: number }) => b.rank !== null && b.points > 0;

/** Rank in each batch, linking to that course's leaderboard tab. */
export function BatchRanks({
  uni,
  boards,
}: {
  uni: string;
  boards: { enrolmentId: string; title: string; subtitle: string; rank: number | null; of: number; points: number; status?: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {boards.map((b) => (
        <Link
          key={b.enrolmentId}
          href={`/${uni}/learn/my/${b.enrolmentId}?tab=leaderboard`}
          className="group flex items-center gap-4 rounded-[22px] border border-line bg-surface p-4 hover:border-brand/40"
        >
          <div
            className={cx(
              "tabular flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl",
              ranked(b) ? "bg-brand-soft text-brand-strong" : "bg-canvas text-muted ring-1 ring-line",
            )}
          >
            <span className="text-[11px] leading-none">Rank</span>
            <span className="text-[22px] font-semibold leading-tight">{ranked(b) ? b.rank : "–"}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium group-hover:text-brand">{b.title}</div>
            <div className="truncate text-[13px] text-muted">
              {b.subtitle}
              {b.status === "completed" ? ", completed" : ""}
            </div>
            <div className="tabular text-[13px] text-muted">
              {ranked(b) ? `${b.points.toLocaleString("en-IN")} XP` : "No XP yet"}, {b.of} {b.of === 1 ? "student" : "students"}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function progressText(b: MyBadge) {
  return `${Math.min(b.value, b.threshold).toLocaleString("en-IN")} of ${b.threshold.toLocaleString("en-IN")}`;
}

/** Earned badges in colour, locked ones in outline with progress. */
export function BadgeShelf({ badges, timeZone }: { badges: MyBadge[]; timeZone: string }) {
  if (badges.length === 0) return <p className="text-[14px] text-muted">Your institute hasn&apos;t set up badges yet.</p>;
  const day = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone }).format(d);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {badges.map((b) => (
        <li key={b.id} className={cx("flex flex-col items-center rounded-[20px] border p-4 text-center", b.earnedAt ? "border-line bg-surface" : "border-dashed border-line")}>
          <BadgeIcon icon={b.icon} size={60} state={b.isNew ? "new" : b.earnedAt ? "earned" : "locked"} />
          <div className={cx("mt-2 text-[14px] font-medium leading-snug", !b.earnedAt && "text-muted")}>{b.name}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted">{b.criterion}</div>
          {b.earnedAt ? (
            <div className={cx("mt-2 text-[12px]", b.isNew ? "font-medium text-gold-strong" : "text-faint")}>{b.isNew ? `New, ${day(b.earnedAt)}` : `Earned ${day(b.earnedAt)}`}</div>
          ) : (
            <div className="mt-2 w-full space-y-1">
              <ProgressBar value={b.value} target={b.threshold} label={`${b.name}: ${progressText(b)}`} />
              <div className="tabular text-[12px] text-muted">{progressText(b)}</div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function daysLeft(n: number) {
  return n === 0 ? "Ends today" : n === 1 ? "Ends tomorrow" : `${n} days left`;
}

/** One challenge with my progress, the leaders and the time left. */
export function ChallengeTile({ c, compact = false }: { c: MyChallenge; compact?: boolean }) {
  const pct = Math.min(c.value, c.target);
  return (
    <div className={cx("rounded-[22px] border p-4 sm:p-5", c.finished ? "border-brand/30 bg-brand-soft/60" : "border-line bg-surface")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-medium leading-snug">{c.title}</div>
          <div className="text-[13px] text-muted">{c.goal}</div>
        </div>
        {c.status === "active" && c.daysLeft !== null && (
          <span className={cx("shrink-0 text-[12px]", c.daysLeft <= 1 ? "font-medium text-gold-strong" : "text-muted")}>{daysLeft(c.daysLeft)}</span>
        )}
        {c.status === "upcoming" && <Badge>Starts {formatDay(c.startDate, { year: false })}</Badge>}
        {c.status === "ended" && <Badge>Ended</Badge>}
      </div>
      {c.status !== "upcoming" && (
        <div className="mt-3 space-y-1.5">
          <ProgressBar value={c.value} target={c.target} label={`${c.title}: ${pct} of ${c.target}`} />
          <div className="flex flex-wrap justify-between gap-2 text-[12px]">
            <span className="tabular text-muted">
              {pct.toLocaleString("en-IN")} of {c.target.toLocaleString("en-IN")} {c.unit}
            </span>
            {c.finished && c.position ? (
              <span className="font-medium text-brand-strong">
                Done, {ordinal(c.position)} to finish
              </span>
            ) : c.status === "ended" ? (
              <span className="text-muted">{c.finishers ? `${c.finishers} finished` : "Nobody finished"}</span>
            ) : (
              <span className="text-muted">{c.finishers ? `${c.finishers} of ${c.members} finished` : `${c.members} taking part`}</span>
            )}
          </div>
        </div>
      )}
      {!compact && c.description && <p className="mt-2 text-[13px] text-muted">{c.description}</p>}
      {!compact && c.leaders.length > 0 && c.status !== "upcoming" && (
        <p className="mt-2 text-[12px] text-muted">
          {c.status === "ended" ? "First to finish" : "Leading"}: {c.leaders.map((l) => l.name).join(", ")}
        </p>
      )}
    </div>
  );
}

export function RecentXp({ items }: { items: { id: string; points: number; reason: string; awardDate: string; courseTitle: string | null }[] }) {
  return (
    <Card>
      <CardTitle>Recent XP</CardTitle>
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">Finish a lesson, pass a test or attend a class to earn your first XP.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5 text-[14px]">
              <span className="tabular w-14 shrink-0 font-semibold text-brand">+{r.points}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.reason}</span>
                {r.courseTitle && <span className="block truncate text-[12px] text-muted">{r.courseTitle}</span>}
              </span>
              <span className="tabular shrink-0 text-[12px] text-muted">{formatDay(r.awardDate, { year: false })}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
