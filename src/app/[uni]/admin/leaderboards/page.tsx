import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, PageHeader, Select, Stat, buttonClass } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { setNameDisplayAction } from "@/modules/gamification/actions";
import { PeriodSwitch, RankList } from "@/modules/gamification/components/board";
import { NoAccess, Podium, SectionNav, unlessForbidden } from "@/modules/gamification/components/staff";
import { periodLabel, scopeKey, staffLeaderboard } from "@/modules/gamification/leaderboards";
import { getNameDisplay, NAME_DISPLAYS } from "@/modules/gamification/settings";
import type { Period } from "@/modules/gamification/catalog";

export const metadata = { title: "Leaderboard" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function LeaderboardPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const data = await unlessForbidden(staffLeaderboard(actor, { scope: one(sp.scope), period: one(sp.period) }));
  if (!data) return <NoAccess title="Leaderboard" />;

  const base = `/${uni}/admin/leaderboards`;
  const manageNames = can(actor, "leaderboard.manage", { universityId: university.id });
  const mode = manageNames ? await getNameDisplay(actor) : null;
  const selected = data.selected;
  const href = (p: Period) => `${base}?${new URLSearchParams({ ...(selected ? { scope: scopeKey(selected.scope) } : {}), period: p })}`;
  const podium = data.rows.filter((r) => r.points > 0 && r.rank <= 3).slice(0, 3);
  const period = periodLabel(data.period);

  return (
    <>
      <SectionNav uni={uni} active="" />
      <PageHeader title="Leaderboard" subtitle="Students ranked by the XP they earned in a course or batch. Ties share a rank." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {data.groups.length > 0 && (
            <Card className="p-4 sm:p-5">
              <form method="get" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="period" value={data.period} />
                <label className="min-w-[240px] flex-1">
                  <span className="mb-1.5 block text-[13px] font-medium">Course or batch</span>
                  <Select name="scope" defaultValue={selected ? scopeKey(selected.scope) : undefined}>
                    {data.groups.map((g) => (
                      <optgroup key={g.courseId} label={g.courseTitle}>
                        {g.options.map((o) => (
                          <option key={scopeKey(o.scope)} value={scopeKey(o.scope)}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
                <button type="submit" className={buttonClass("secondary")}>
                  Show leaderboard
                </button>
              </form>
            </Card>
          )}

          {selected ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[20px] font-semibold leading-tight">{selected.title}</h2>
                  <p className="text-[14px] text-muted">
                    {selected.subtitle}, {period.toLowerCase()}
                  </p>
                </div>
                <PeriodSwitch active={data.period} href={href} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Students" value={data.rows.length} />
                <Stat label="XP earned" value={data.totals.points.toLocaleString("en-IN")} hint={period} />
                <Stat label="Earning XP" value={data.totals.earners} hint={`of ${data.rows.length} students`} />
              </div>
              {podium.length > 0 && <Podium rows={podium} />}
              <Card>
                <CardTitle hint={data.totals.earners === 0 ? `No XP ${period.toLowerCase()} yet` : undefined}>Everyone</CardTitle>
                <RankList rows={data.rows} emptyText="No students in this batch yet." />
              </Card>
            </>
          ) : (
            <Empty title="No leaderboards to show yet">Leaderboards appear for published courses and their batches.</Empty>
          )}
        </div>

        <div className="space-y-6">
          {mode && (
            <Card>
              <CardTitle>Student names</CardTitle>
              <p className="mb-4 text-[14px] text-muted">How students see each other on leaderboards. Staff always see full names.</p>
              <ActionForm action={setNameDisplayAction} resetOnSuccess={false} className="space-y-3">
                <input type="hidden" name="uni" value={uni} />
                {NAME_DISPLAYS.map((o) => (
                  <label key={o.key} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line px-4 py-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                    <input type="radio" name="nameDisplay" value={o.key} defaultChecked={mode === o.key} className="accent-[var(--color-brand)]" />
                    <span className="min-w-0 flex-1 text-[14px] font-medium">{o.label}</span>
                    <span className="text-[13px] text-muted">{o.example}</span>
                  </label>
                ))}
                <SubmitButton variant="secondary">Save name setting</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card>
            <CardTitle>The XP system</CardTitle>
            <ul className="space-y-3 text-[14px]">
              <li>
                <Link href={`${base}/xp-rules`} className="font-medium text-brand hover:underline">
                  XP rules
                </Link>
                <div className="text-muted">What earns points, like finishing a lesson or passing a test.</div>
              </li>
              <li>
                <Link href={`${base}/badges`} className="font-medium text-brand hover:underline">
                  Badges
                </Link>
                <div className="text-muted">Milestones students collect, like 10 lessons or 500 XP.</div>
              </li>
              <li>
                <Link href={`${base}/challenges`} className="font-medium text-brand hover:underline">
                  Challenges
                </Link>
                <div className="text-muted">Time-bound goals for a batch or a course.</div>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
