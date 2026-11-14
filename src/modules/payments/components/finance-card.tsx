import Link from "next/link";
import type { DashboardCardProps, DashboardRow } from "@/contracts/module";
import { Card, CardTitle } from "@/components/ui";
import { financeAttention } from "../sales";

/** Compact: failed refunds as one "Needs you" row. */
export async function failedRefundRows({ uni, actor }: DashboardCardProps): Promise<DashboardRow[]> {
  const a = await financeAttention(actor);
  if (!a || a.failedRefunds === 0) return [];
  return [
    {
      key: "failed-refunds",
      text: `${a.failedRefunds === 1 ? "1 refund" : `${a.failedRefunds} refunds`} failed in the last 14 days`,
      detail: "Open the order and send it again.",
      href: `/${uni}/admin/finance/sales`,
      link: "Open sales",
      tone: "danger",
    },
  ];
}

/**
 * dashboardCards: refunds that failed and need sending again. Refunds still to send are listed
 * once, in the dashboard's "Needs you"; this card shows only when a refund went wrong.
 */
export async function RefundsDueCard({ uni, actor }: DashboardCardProps) {
  const a = await financeAttention(actor);
  if (!a || a.failedRefunds === 0) return null;
  return (
    <Card className="border-gold/60">
      <CardTitle
        hint={
          <Link href={`/${uni}/admin/finance/sales`} className="text-brand hover:underline">
            Open sales
          </Link>
        }
      >
        Refunds that failed
      </CardTitle>
      <p className="text-[14px] text-muted">
        {a.failedRefunds === 1 ? "One refund" : `${a.failedRefunds} refunds`} failed in the last 14 days. Open the order and send it again.
      </p>
    </Card>
  );
}
