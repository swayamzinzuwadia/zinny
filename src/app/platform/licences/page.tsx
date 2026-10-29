import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Empty, PageHeader, Stat, Table, Td } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { checkLicencesAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess, PlanBadge, RenewalText, StatusBadge, UsageMeter } from "@/modules/zinny-team-panel/components/bits";
import { MODULE_LABEL, PLAN_LABELS, PLANS } from "@/modules/zinny-team-panel/lib/constants";
import { formatCount, formatDate } from "@/modules/zinny-team-panel/lib/format";
import { listAlerts, listLicences } from "@/modules/zinny-team-panel/services/licences";

export const metadata = { title: "Licences" };

export default async function LicencesPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Licences" who="Super Admins, Account Managers and Finance Admins" />;
  const [rows, alerts] = await Promise.all([listLicences(actor), listAlerts(actor)]);
  const licensed = rows.filter((r) => r.licence);
  const renewing = licensed.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30).length;
  const ended = licensed.filter((r) => r.daysLeft !== null && r.daysLeft < 0).length;
  const nearCap = licensed.filter((r) => (r.studentPct ?? 0) >= 90 || (r.staffPct ?? 0) >= 90).length;

  return (
    <>
      <PageHeader
        title="Licences"
        subtitle="Plan, caps, modules and term for each university, with usage against the caps. Warnings appear on the home page at 90% of a cap and 30 days before a licence ends."
        actions={
          <ActionForm action={checkLicencesAction} className="flex flex-col items-end">
            <SubmitButton variant="secondary" pendingText="Checking…">
              Check all licences now
            </SubmitButton>
          </ActionForm>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Licensed" value={`${formatCount(licensed.length)} of ${formatCount(rows.length)}`} hint={PLANS.map((p) => `${licensed.filter((r) => r.licence?.plan === p).length} ${PLAN_LABELS[p]}`).join(" · ")} />
        <Stat label="Renewing in 30 days" value={formatCount(renewing)} hint={ended ? `${ended} already ended` : "None ended"} />
        <Stat label="At 90% of a cap" value={formatCount(nearCap)} hint="Students or staff" />
        <Stat label="Open warnings" value={formatCount(alerts.length)} hint={`${alerts.filter((a) => a.acknowledgedAt).length} marked as handled`} />
      </div>

      {rows.length === 0 ? (
        <Empty title="No universities yet">Create a university first, then set up its licence.</Empty>
      ) : (
        <Table head={["University", "Plan", "Students", "Staff", "Modules", "Term", ""]}>
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
              </Td>
              <Td>
                <PlanBadge plan={r.licence?.plan ?? null} />
              </Td>
              <Td>
                <UsageMeter used={r.usage.students} cap={r.licence?.studentCap ?? null} compact />
              </Td>
              <Td>
                <UsageMeter used={r.usage.staff} cap={r.licence?.staffCap ?? null} compact />
              </Td>
              <Td className="text-[13px] text-muted">
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
              <Td className="whitespace-nowrap text-right">
                {r.openAlerts > 0 && (
                  <span className="mr-3">
                    <Badge tone="gold">
                      {r.openAlerts} warning{r.openAlerts === 1 ? "" : "s"}
                    </Badge>
                  </span>
                )}
                <Link href={`/platform/licences/${r.universityId}`} className="text-[13px] font-medium text-brand hover:underline">
                  {r.licence ? "Edit" : "Set up"}
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
