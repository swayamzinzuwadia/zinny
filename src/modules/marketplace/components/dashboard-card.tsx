import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import type { DashboardCardProps } from "@/contracts/module";
import { inr } from "@/modules/payments/money";
import { salesSummary } from "../listings";

/** Admin dashboard → Marketplace (dashboardCards.marketplace-sales), for the listings this person manages. */
export async function MarketplaceDashboardCard({ uni, actor, today }: DashboardCardProps) {
  const s = await salesSummary(actor, today);
  const base = `/${uni}/admin/products/marketplace`;
  const listed = s.live + s.paused > 0;
  return (
    <Card>
      <CardTitle hint={listed ? "Before GST" : undefined}>Marketplace sales</CardTitle>
      {listed ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="tabular text-[40px] font-semibold leading-none">{inr(s.earnedPaise)}</div>
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
