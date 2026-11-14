import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import type { DashboardCardProps, DashboardLine } from "@/contracts/module";
import { inr } from "@/modules/payments/money";
import { salesSummary } from "../listings";

/** Compact: the "This month" line on the dashboard, in whole rupees before GST. */
export async function marketplaceMonthLines({ uni, actor, today }: DashboardCardProps): Promise<DashboardLine[]> {
  const s = await salesSummary(actor, today);
  const listed = s.live + s.paused > 0;
  const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
  return [
    {
      key: "sales",
      label: "Marketplace sales",
      value: listed ? rupees(s.earnedThisMonthPaise) : "None",
      hint: listed ? `${rupees(s.earnedPaise)} in all, ${s.buyers} ${s.buyers === 1 ? "buyer" : "buyers"}, before GST` : "Nothing on sale yet",
      href: `/${uni}/admin/marketplace`,
      link: listed ? "Manage listings" : "List something",
    },
  ];
}

/** Admin dashboard → Marketplace (dashboardCards.marketplace-sales), for the listings this person manages. */
export async function MarketplaceDashboardCard({ uni, actor, today }: DashboardCardProps) {
  const s = await salesSummary(actor, today);
  const base = `/${uni}/admin/marketplace`;
  const listed = s.live + s.paused > 0;
  return (
    <Card>
      <CardTitle hint={listed ? "Before GST" : undefined}>Marketplace sales</CardTitle>
      {listed ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="tabular text-[28px] font-medium leading-none">{inr(s.earnedPaise)}</div>
          <div className="pb-1 text-[13px] text-muted">
            {inr(s.earnedThisMonthPaise)} this month
            <span className="block">
              {s.buyers} {s.buyers === 1 ? "buyer" : "buyers"} · {s.live} on sale{s.paused > 0 && `, ${s.paused} paused`}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-[14px] text-muted">Nothing on sale yet. List a recorded course or a single lecture and anyone on Zinny can buy it.</p>
      )}
      <div className="mt-4 flex gap-4 text-[14px]">
        <Link href={base} className="font-medium text-brand hover:underline">
          {listed ? "Manage listings" : "List something"}
        </Link>
        {s.live > 0 && (
          <Link href={`/marketplace?institute=${uni}`} className="text-muted hover:text-ink">
            See it as buyers do
          </Link>
        )}
      </div>
    </Card>
  );
}
