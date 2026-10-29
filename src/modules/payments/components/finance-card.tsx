import Link from "next/link";
import type { DashboardCardProps } from "@/contracts/module";
import { Card, CardTitle } from "@/components/ui";
import { inr } from "../money";
import { financeAttention } from "../sales";

/** dashboardCards: refunds the accounts team still has to send, shown only when there are some. */
export async function RefundsDueCard({ uni, actor }: DashboardCardProps) {
  const a = await financeAttention(actor);
  if (!a || (a.dueCount === 0 && a.failedRefunds === 0)) return null;
  const sales = `/${uni}/admin/finance/sales`;
  return (
    <Card className="border-gold/60">
      <CardTitle hint={<Link href={`${sales}?status=refund_due`} className="text-brand hover:underline">Open Sales</Link>}>Refunds to send</CardTitle>
      {a.dueCount > 0 && (
        <p className="mb-3 text-[14px] text-muted">
          {a.dueCount === 1 ? "One student" : `${a.dueCount} students`} paid after their batch filled up. Refund them in full.
        </p>
      )}
      <ul className="divide-y divide-line">
        {a.due.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
            <Link href={`${sales}?order=${o.id}`} className="min-w-0 hover:text-brand">
              <div className="truncate text-[14px] font-medium">{o.studentName}</div>
              <div className="truncate text-[13px] text-muted">
                {o.course} · {o.batch}
              </div>
            </Link>
            <span className="tabular shrink-0 text-[14px] font-medium">{inr(o.totalPaise - o.refundedPaise - o.refundInFlightPaise)}</span>
          </li>
        ))}
      </ul>
      {a.failedRefunds > 0 && (
        <p className="mt-3 text-[13px] text-danger">
          {a.failedRefunds === 1 ? "One refund" : `${a.failedRefunds} refunds`} failed in the last 14 days. Open the order to try again.
        </p>
      )}
    </Card>
  );
}
