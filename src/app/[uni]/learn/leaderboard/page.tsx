import Link from "next/link";
import { Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import type { Period } from "@/modules/gamification/catalog";
import { BadgeIcon } from "@/modules/gamification/components/badge-icon";
import { PeriodSwitch } from "@/modules/gamification/components/board";
import { BadgeShelf, BatchRanks, ChallengeTile, RecentXp, XpHero } from "@/modules/gamification/components/learner";
import { myXpPage } from "@/modules/gamification/learner";
import { periodLabel } from "@/modules/gamification/leaderboards";

export const metadata = { title: "XP and leaderboard" };

type Search = Record<string, string | string[] | undefined>;

export default async function LearnerLeaderboard({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "self.view_xp", { universityId: university.id, ownerUserId: actor.userId })) {
    return (
      <>
        <h1 className="mb-5 text-[26px] font-semibold tracking-tight">XP and leaderboard</h1>
        <Empty title="XP is for current students">
          <Link href={`/${uni}/learn`} className="text-brand">
            Back to today
          </Link>
        </Empty>
      </>
    );
  }
  const data = await myXpPage(actor, { period: typeof sp.period === "string" ? sp.period : null });
  const earned = data.badges.filter((b) => b.earnedAt);
  const live = data.challenges.filter((c) => c.status !== "ended");
  const ended = data.challenges.filter((c) => c.status === "ended");
  const href = (p: Period) => `/${uni}/learn/leaderboard?period=${p}`;

  return (
    <div className="space-y-8">
      <h1 className="sr-only">XP and leaderboard</h1>
      <XpHero total={data.total} week={data.week} month={data.month}>
        <div className="mt-6 flex items-center gap-3 border-t border-canvas/15 pt-4">
          <div className="flex -space-x-2">
            {earned.slice(0, 4).map((b) => (
              <span key={b.id} className="rounded-full ring-2 ring-brand-deep">
                <BadgeIcon icon={b.icon} size={34} />
              </span>
            ))}
          </div>
          <span className="text-[14px] text-canvas/80">
            {earned.length} of {data.badges.length} badges earned
          </span>
        </div>
      </XpHero>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-medium">Your rank in each batch</h2>
          <PeriodSwitch active={data.period} href={href} />
        </div>
        {data.boards.length === 0 ? (
          <Empty title="You're not in a batch yet">
            <Link className="text-brand" href={`/${uni}/learn/courses`}>
              Pick a course and a batch
            </Link>
          </Empty>
        ) : (
          <>
            <BatchRanks uni={uni} boards={data.boards} />
            <p className="mt-2 text-[12px] text-muted">{periodLabel(data.period)}. Open a batch to see its full leaderboard.</p>
          </>
        )}
      </section>

      {live.length > 0 && (
        <section>
          <h2 className="mb-3 text-[17px] font-medium">Challenges</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {live.map((c) => (
              <ChallengeTile key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[17px] font-medium">
          Badges <span className="text-[14px] font-normal text-muted">{earned.length} earned</span>
        </h2>
        <BadgeShelf badges={data.badges} timeZone={university.timezone} />
      </section>

      {ended.length > 0 && (
        <section>
          <h2 className="mb-3 text-[17px] font-medium">Recently ended</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {ended.map((c) => (
              <ChallengeTile key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

      <RecentXp items={data.recent} />
    </div>
  );
}
