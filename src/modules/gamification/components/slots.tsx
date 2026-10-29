/**
 * What gamification shows inside core pages (contracts.md section 3):
 *   learnerHomeCards.xp            learner home: my XP, best rank, the running challenge or next badge
 *   learnerHubSections.xp          My learning: XP, rank per course, badges
 *   learnerCourseTabs.leaderboard  course hub: my batch's (or the course's) leaderboard and its challenges
 *   dashboardCards.top-learners    admin dashboard: top learners within the viewer's reach
 */
import Link from "next/link";
import { Card, CardTitle, cx } from "@/components/ui";
import type { DashboardCardProps, HomeCardProps, HubSectionProps, LearnerCourseTabProps } from "@/contracts/module";
import { ordinal } from "../challenges";
import { learnerBoard, myXpSummary } from "../learner";
import { topLearners } from "../leaderboards";
import { BadgeIcon } from "./badge-icon";
import { PeriodSwitch, ProgressBar, RankList } from "./board";
import { ChallengeTile } from "./learner";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

function NextBadge({ badge }: { badge: NonNullable<Awaited<ReturnType<typeof myXpSummary>>["badges"]["next"]> }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
      <BadgeIcon icon={badge.icon} size={40} state="locked" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-muted">Next badge</div>
        <div className="truncate text-[14px] font-medium">
          {badge.name}: {badge.criterion.charAt(0).toLowerCase() + badge.criterion.slice(1)}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar value={badge.value} target={badge.threshold} label={`${badge.name} progress`} />
          </div>
          <span className="tabular text-[12px] text-muted">
            {Math.min(badge.value, badge.threshold)}/{badge.threshold}
          </span>
        </div>
      </div>
    </div>
  );
}

/** learnerHomeCards.xp */
export async function XpHomeCard({ uni, actor }: HomeCardProps) {
  const s = await myXpSummary(actor);
  return (
    <Card>
      <CardTitle
        hint={
          <Link href={`/${uni}/learn/leaderboard`} className="font-medium text-brand hover:underline">
            Open leaderboard
          </Link>
        }
      >
        Your XP
      </CardTitle>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <span className="tabular text-[40px] font-semibold leading-none">{s.total.toLocaleString("en-IN")}</span>
        <span className="tabular pb-1 text-[14px] text-muted">+{s.week.toLocaleString("en-IN")} this week</span>
      </div>
      <p className="mt-2 text-[14px] text-muted">
        {s.best ? (
          <>
            You&apos;re <span className="font-medium text-ink">{ordinal(s.best.rank!)}</span> of {s.best.of} in {s.best.title}, {s.best.subtitle}.
          </>
        ) : (
          "Finish a lesson, pass a test or attend a class to get on the leaderboard."
        )}
      </p>
      <div className="mt-4 space-y-3">
        {s.challenge ? <ChallengeTile c={s.challenge} compact /> : s.badges.next ? <NextBadge badge={s.badges.next} /> : null}
      </div>
    </Card>
  );
}

/** learnerHubSections.xp */
export async function XpHubSection({ uni, actor }: HubSectionProps) {
  const s = await myXpSummary(actor);
  return (
    <Card>
      <CardTitle
        hint={
          <Link href={`/${uni}/learn/leaderboard`} className="font-medium text-brand hover:underline">
            See all
          </Link>
        }
      >
        XP and badges
      </CardTitle>
      <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
        <div>
          <div className="tabular text-[36px] font-semibold leading-none">{s.total.toLocaleString("en-IN")}</div>
          <div className="mt-1 text-[13px] text-muted">XP in all, +{s.week.toLocaleString("en-IN")} this week</div>
        </div>
        {s.ranks.length > 0 && (
          <ul className="space-y-2">
            {s.ranks.map((r) => (
              <li key={r.enrolmentId}>
                <Link href={`/${uni}/learn/my/${r.enrolmentId}?tab=leaderboard`} className="group flex items-center justify-between gap-3 text-[14px]">
                  <span className="min-w-0 truncate group-hover:text-brand">
                    {r.title}, <span className="text-muted">{r.subtitle}</span>
                  </span>
                  <span className="tabular shrink-0 text-muted">
                    {r.rank ? (
                      <>
                        <span className="font-medium text-ink">{ordinal(r.rank)}</span> of {r.of}
                      </>
                    ) : (
                      "–"
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-5 border-t border-line pt-4">
        {s.badges.earned.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {s.badges.earned.map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-full bg-canvas py-1 pl-1 pr-3 text-[13px]">
                <BadgeIcon icon={b.icon} size={30} state={b.isNew ? "new" : "earned"} />
                <span className="font-medium">{b.name}</span>
              </li>
            ))}
          </ul>
        ) : s.badges.next ? (
          <NextBadge badge={s.badges.next} />
        ) : (
          <p className="text-[14px] text-muted">No badges yet.</p>
        )}
      </div>
    </Card>
  );
}

/** learnerCourseTabs.leaderboard */
export async function CourseLeaderboardTab({ uni, actor, enrolment, searchParams }: LearnerCourseTabProps) {
  const board = one(searchParams.board) === "course" ? "course" : "batch";
  const data = await learnerBoard(actor, { batchId: enrolment.batchId, board, period: one(searchParams.period) });
  const base = `/${uni}/learn/my/${enrolment.enrolmentId}?tab=leaderboard`;
  const tied = data.me ? data.rows.filter((r) => r.rank === data.me!.rank).length > 1 : false;
  const periodText = { week: "this week", month: "this month", all: "so far" }[data.period];
  return (
    <div className="space-y-5">
      {data.challenges.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.challenges.map((c) => (
            <ChallengeTile key={c.id} c={c} />
          ))}
        </div>
      )}
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <nav className="inline-flex gap-1 rounded-full border border-line bg-surface p-1" aria-label="Leaderboard">
            {(["batch", "course"] as const).map((b) => (
              <Link
                key={b}
                href={`${base}&board=${b}&period=${data.period}`}
                aria-current={b === board ? "page" : undefined}
                className={cx("rounded-full px-3.5 py-1 text-[13px]", b === board ? "bg-brand font-medium text-canvas" : "text-muted hover:text-ink")}
              >
                {b === "batch" ? "My batch" : "Whole course"}
              </Link>
            ))}
          </nav>
          <PeriodSwitch active={data.period} href={(p) => `${base}&board=${board}&period=${p}`} />
        </div>
        <p className="mb-3 text-[14px] text-muted">
          {data.me ? (
            <>
              You&apos;re {tied ? "joint " : ""}
              <span className="font-medium text-ink">{ordinal(data.me.rank)}</span> of {data.rows.length} with{" "}
              <span className="tabular font-medium text-ink">{data.me.points.toLocaleString("en-IN")} XP</span> {periodText}.
            </>
          ) : (
            `${data.title.subtitle}, ranked by XP ${periodText}.`
          )}
        </p>
        <RankList rows={data.rows} me={actor.userId} limit={25} />
      </Card>
    </div>
  );
}

/** dashboardCards.top-learners */
export async function TopLearnersCard({ uni, actor }: DashboardCardProps) {
  const data = await topLearners(actor, { period: "month", limit: 5 });
  return (
    <Card>
      <CardTitle
        hint={
          <Link href={`/${uni}/admin/leaderboards`} className="font-medium text-brand hover:underline">
            Open leaderboard
          </Link>
        }
      >
        Top learners this month
      </CardTitle>
      <RankList rows={data.rows} emptyText="No XP earned this month yet." />
      {data.earners > 0 && (
        <p className="mt-3 text-[13px] text-muted">
          {data.total.toLocaleString("en-IN")} XP earned by {data.earners} {data.earners === 1 ? "student" : "students"} this month.
        </p>
      )}
    </Card>
  );
}
