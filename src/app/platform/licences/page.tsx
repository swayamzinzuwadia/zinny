import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Empty, PageHeader, Stat, Td, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { checkLicencesAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess, PanelTable, PlanBadge, RenewalText, StatusBadge, UsageMeter, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { MODULE_LABEL } from "@/modules/zinny-team-panel/lib/constants";
import { formatCount, formatDate } from "@/modules/zinny-team-panel/lib/format";
import { listAlerts, listLicences } from "@/modules/zinny-team-panel/services/licences";

export const metadata = { title: "Licences" };

export default async function LicencesPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Licences" />;
  const [rows, alerts] = await Promise.all([listLicences(actor), listAlerts(actor)]);
  const licensed = rows.filter((r) => r.licence);
  const renewing = licensed.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30).length;
  const ended = licensed.filter((r) => r.daysLeft !== null && r.daysLeft < 0).length;
  // How many institutes are on each plan, by the plan's name, biggest first.
  const byPlan = new Map<string, number>();
  for (const r of licensed) byPlan.set(r.planName ?? "", (byPlan.get(r.planName ?? "") ?? 0) + 1);
  const planHint = [...byPlan].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${n} ${name}`).join(" · ") || "No licences yet";
  const nearCap = licensed.filter((r) => (r.studentPct ?? 0) >= 90 || (r.staffPct ?? 0) >= 90).length;

  return (
    <>
      <PageHeader
        title="Licences"
        subtitle="Plan, price, caps, modules and term for each institute, with usage against the caps. Setting up or renewing a licence invoices the institute for its plan. Warnings appear on the home page at 90% of a cap and 30 days before a licence ends."
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <Link href="/platform/plans" className="inline-flex h-10 items-center whitespace-nowrap rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
              Plans and prices
            </Link>
          <ActionForm action={checkLicencesAction} className="flex flex-col items-end">
            <SubmitButton variant="secondary" pendingText="Checking…">
              Check all licences now
            </SubmitButton>
          </ActionForm>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Licensed" value={`${formatCount(licensed.length)} of ${formatCount(rows.length)}`} hint={planHint} />
        <Stat label="Renewing in 30 days" value={formatCount(renewing)} hint={ended ? `${ended} already ended` : "None ended"} />
        <Stat label="At 90% of a cap" value={formatCount(nearCap)} hint="Students or staff" />
        <Stat label="Open warnings" value={formatCount(alerts.length)} hint={`${alerts.filter((a) => a.acknowledgedAt).length} marked as handled`} />
      </div>

      {rows.length === 0 ? (
        <Empty title="No institutes yet">Create an institute first, then set up its licence.</Empty>
      ) : (
        <PanelTable
          head={[
            "Institute",
            { label: "Plan", className: WIDE_ONLY },
            "Students",
            { label: "Staff", className: WIDE_ONLY },
            { label: "Modules", className: WIDE_ONLY },
            "Term",
            { label: <span className="sr-only">Actions</span> },
          ]}
        >
          {rows.map((r) => (
            <tr key={r.universityId} className="hover:bg-canvas/60">
              <Td>
                <Link href={`/platform/licences/${r.universityId}`} className="font-medium text-ink hover:text-brand">
                  {r.universityName}
                </Link>
                {r.status !== "active" && (
                  <div className="mt-1">
                    <StatusBadge status={r.status} />
                  </div>
                )}
                <div className="mt-1 xl:hidden">
                  <PlanBadge name={r.planName} />
                </div>
              </Td>
              <Td className={WIDE_ONLY}>
                <PlanBadge name={r.planName} />
              </Td>
              <Td>
                <UsageMeter used={r.usage.students} cap={r.licence?.studentCap ?? null} compact />
              </Td>
              <Td className={WIDE_ONLY}>
                <UsageMeter used={r.usage.staff} cap={r.licence?.staffCap ?? null} compact />
              </Td>
              <Td className={cx(WIDE_ONLY, "text-[13px] text-muted")}>
                {r.licence ? (
                  <span title={r.licence.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ")}>
                    {r.licence.modules.length} of {Object.keys(MODULE_LABEL).length}
                  </span>
                ) : (
                  ""
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {r.licence ? (
                  <>
                    <div className="tabular text-[13px]">
                      {formatDate(r.licence.startDate, { year: false })} to {formatDate(r.licence.endDate)}
                    </div>
                    <div className="text-[12.5px]">
                      <RenewalText daysLeft={r.daysLeft} />
                    </div>
                  </>
                ) : (
                  <span className="text-faint">Not set</span>
                )}
              </Td>
              <Td>
                <div className="flex flex-col items-end gap-1.5 whitespace-nowrap">
                  {r.openAlerts > 0 && (
                    <Badge tone="gold">
                      {r.openAlerts} warning{r.openAlerts === 1 ? "" : "s"}
                    </Badge>
                  )}
                  <Link href={`/platform/licences/${r.universityId}`} className="text-[13px] font-medium text-brand hover:underline">
                    {r.licence ? "Edit" : "Set up"}
                  </Link>
                </div>
              </Td>
            </tr>
          ))}
        </PanelTable>
      )}
    </>
  );
}
