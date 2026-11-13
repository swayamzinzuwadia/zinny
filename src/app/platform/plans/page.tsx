import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Notice, PageHeader, Stat, Td, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { archivePlanAction, deletePlanAction, restorePlanAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess, PanelTable, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { PlanForm } from "@/modules/zinny-team-panel/components/plan-form";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { MODULE_LABEL } from "@/modules/zinny-team-panel/lib/constants";
import { formatCount, formatINR, plural } from "@/modules/zinny-team-panel/lib/format";
import { listPlans } from "@/modules/zinny-team-panel/services/plans";

export const metadata = { title: "Plans" };

const period = (months: number) => (months === 12 ? "a year" : months === 1 ? "a month" : `${months} months`);

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ created?: string; deleted?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Plans" />;
  const { created, deleted } = await searchParams;
  const plans = await listPlans(actor);
  const canEdit = isSuperAdmin(actor);
  const live = plans.filter((p) => !p.archivedAt);
  const moduleCount = Object.keys(MODULE_LABEL).length;

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="What Zinny sells and at what fixed price. A new licence copies its plan's caps, modules, term and price, and the institute is invoiced for it. Changing a plan here only affects licences and invoices made afterwards."
      />

      {created && (
        <div className="mb-6">
          <Notice>The plan is created. It can be chosen for licences now.</Notice>
        </div>
      )}

      {deleted && (
        <div className="mb-6">
          <Notice>The plan is deleted.</Notice>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Plans on offer" value={formatCount(live.length)} hint={plans.length > live.length ? `${plans.length - live.length} archived` : "None archived"} />
        <Stat label="Institutes on a plan" value={formatCount(plans.reduce((n, p) => n + p.institutes, 0))} hint={live.map((p) => `${p.institutes} ${p.name}`).join(" · ")} />
        <Stat label="Who can change plans" value="Super Admins" hint="Everyone with Licences can see them" />
      </div>

      <PanelTable
        head={[
          "Plan",
          "Price before GST",
          { label: "Period", className: WIDE_ONLY },
          "Caps",
          { label: "Modules", className: WIDE_ONLY },
          "Institutes",
          { label: <span className="sr-only">Actions</span> },
        ]}
      >
        {plans.map((p) => (
          <tr key={p.id} className={cx("align-top hover:bg-canvas/60", p.archivedAt && "text-muted")}>
            <Td>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{p.name}</span>
                {p.archivedAt && <Badge>Archived</Badge>}
              </div>
              <div className="font-mono text-[12px] text-faint">{p.key}</div>
              {p.description && <div className="mt-1 max-w-[320px] text-[13px] text-muted">{p.description}</div>}
            </Td>
            <Td className="whitespace-nowrap">
              <div className="tabular font-medium text-ink">{p.pricePaise === 0 ? "Free" : formatINR(p.pricePaise)}</div>
              <div className="text-[12.5px] text-muted">
                plus {p.gstRateBp / 100}% GST <span className="xl:hidden">· for {period(p.billingMonths)}</span>
              </div>
            </Td>
            <Td className={cx(WIDE_ONLY, "whitespace-nowrap")}>{period(p.billingMonths).replace(/^a /, "1 ")}</Td>
            <Td className="whitespace-nowrap text-[13px]">
              <div className="tabular">{plural(p.studentCap, "student")}</div>
              <div className="tabular text-muted">{formatCount(p.staffCap)} staff</div>
            </Td>
            <Td className={cx(WIDE_ONLY, "text-[13px] text-muted")}>
              <span title={p.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ")}>
                {p.modules.length} of {moduleCount}
              </span>
            </Td>
            <Td className="tabular">{formatCount(p.institutes)}</Td>
            <Td>
              {canEdit && (
                <div className="flex flex-col items-end gap-1.5 whitespace-nowrap">
                  <Link href={`/platform/plans/${p.id}`} className="text-[13px] font-medium text-brand hover:underline">
                    Edit
                  </Link>
                  {p.archivedAt ? (
                    <ActionForm action={restorePlanAction}>
                      <input type="hidden" name="planId" value={p.id} />
                      <SubmitButton size="sm" variant="secondary">
                        Restore plan
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <ActionForm action={archivePlanAction} confirm={`Archive ${p.name}? It can't be chosen for new licences. ${p.institutes ? `The ${plural(p.institutes, "institute")} on it keep${p.institutes === 1 ? "s" : ""} it.` : ""}`}>
                      <input type="hidden" name="planId" value={p.id} />
                      <SubmitButton size="sm" variant="secondary">
                        Archive plan
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {p.institutes === 0 && (
                    <ActionForm action={deletePlanAction} confirm={`Delete ${p.name}? This can't be undone.`}>
                      <input type="hidden" name="planId" value={p.id} />
                      <SubmitButton size="sm" variant="danger" pendingText="Deleting…">
                        Delete plan
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
            </Td>
          </tr>
        ))}
      </PanelTable>

      {canEdit ? (
        <Card className="mt-6 max-w-4xl">
          <CardTitle hint="Prices are fixed per plan; a discount is given on the licence">New plan</CardTitle>
          <PlanForm />
        </Card>
      ) : (
        <p className="mt-4 text-[13px] text-muted">Only a Super Admin can create, change or archive plans.</p>
      )}
    </>
  );
}
