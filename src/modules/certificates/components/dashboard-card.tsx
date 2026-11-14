import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import type { DashboardCardProps, DashboardLine, DashboardRow } from "@/contracts/module";
import { canManageTemplates, dashboardSummary, EXPIRING_SOON_DAYS } from "../service";

/** Compact: the "This month" line on the dashboard. */
export async function certificatesMonthLines({ uni, actor, today }: DashboardCardProps): Promise<DashboardLine[]> {
  const s = await dashboardSummary(actor, today);
  return [
    {
      key: "issued",
      label: "Certificates issued",
      value: String(s.thisMonth),
      hint: `${s.lastMonth} last month`,
      href: `/${uni}/admin/products/certificates#issued`,
      link: "See certificates",
    },
  ];
}

/** Compact: certificates about to expire, as one "Needs you" row. */
export async function certificatesRows({ uni, actor, today }: DashboardCardProps): Promise<DashboardRow[]> {
  const s = await dashboardSummary(actor, today);
  if (s.expiringSoon === 0) return [];
  return [
    {
      key: "expiring",
      text: `${s.expiringSoon === 1 ? "1 certificate expires" : `${s.expiringSoon} certificates expire`} in the next ${EXPIRING_SOON_DAYS} days`,
      href: `/${uni}/admin/products/certificates#issued`,
      link: "See certificates",
      tone: "warn",
    },
  ];
}

/** Admin dashboard → Certificates issued this month (dashboardCards.certificates-issued), within the viewer's reach. */
export async function CertificatesDashboardCard({ uni, actor, today }: DashboardCardProps) {
  const s = await dashboardSummary(actor, today);
  const month = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long" }).format(new Date(`${today}T00:00:00Z`));
  const base = `/${uni}/admin/products/certificates`;
  return (
    <Card>
      <CardTitle hint={month}>Certificates issued</CardTitle>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="tabular text-[28px] font-medium leading-none">{s.thisMonth}</div>
        <div className="pb-1 text-[13px] text-muted">
          {s.thisMonth > 0 ? `${s.automatic} automatic, ${s.manual} by hand` : "None yet this month"}
          <span className="block">{s.lastMonth} last month</span>
        </div>
      </div>
      {s.expiringSoon > 0 && (
        <div className="mt-4 flex gap-2 rounded-xl bg-gold-soft px-4 py-3 text-[14px]">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
          <span>
            {s.expiringSoon === 1 ? "1 certificate expires" : `${s.expiringSoon} certificates expire`} in the next {EXPIRING_SOON_DAYS} days.
          </span>
        </div>
      )}
      <div className="mt-4 flex gap-4 text-[14px]">
        <Link href={`${base}#issued`} className="font-medium text-brand hover:underline">
          See issued certificates
        </Link>
        {canManageTemplates(actor) && (
          <Link href={base} className="text-muted hover:text-ink">
            Templates
          </Link>
        )}
      </div>
    </Card>
  );
}
