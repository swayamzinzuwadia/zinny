import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, Notice, PageHeader, Td, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { archivePlanAction, deletePlanAction, restorePlanAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess, PanelTable, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { MODULE_LABEL } from "@/modules/zinny-team-panel/lib/constants";
import { formatCount, formatINR, plural } from "@/modules/zinny-team-panel/lib/format";
import { listPlans } from "@/modules/zinny-team-panel/services/plans";

export const metadata = { title: "Plans and prices" };

/** "₹7,20,000 for 12 months". */
const priceFor = (paise: number, months: number) => (paise === 0 ? `Free for ${plural(months, "month")}` : `${formatINR(paise)} for ${plural(months, "month")}`);

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ created?: string; deleted?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Plans and prices" />;
  const { created, deleted } = await searchParams;
  const plans = await listPlans(actor);
  const canEdit = isSuperAdmin(actor);
  const moduleCount = Object.keys(MODULE_LABEL).length;

  return (
    <>
      <PageHeader
        title="Plans and prices"
        subtitle="What Zinny sells and at what price. A new licence takes its plan's price and the institute is invoiced for it automatically. A price change applies to new licences and to renewals."
        actions={canEdit ? <ButtonLink href="/platform/plans/new">Add a plan</ButtonLink> : undefined}
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

      <PanelTable
        head={[
          "Plan",
          "Price before GST",
          { label: "GST", className: WIDE_ONLY },
          "Caps",
          { label: "Modules", className: WIDE_ONLY },
          "Licences",
          { label: <span className="sr-only">Actions</span> },
        ]}
      >
        {plans.map((p) => (
          <tr key={p.id} className={cx("hover:bg-canvas/60", p.archivedAt && "text-muted")}>
            <Td>
              <div className="flex flex-wrap items-center gap-2">
                {canEdit ? (
                  <Link href={`/platform/plans/${p.id}`} className="font-medium text-ink hover:text-brand">
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{p.name}</span>
                )}
                {p.archivedAt && <Badge>Archived</Badge>}
              </div>
              {p.description && <div className="mt-0.5 max-w-[300px] text-[13px] text-muted">{p.description}</div>}
            </Td>
            <Td className="whitespace-nowrap">
              <div className="tabular font-medium text-ink">{priceFor(p.pricePaise, p.billingMonths)}</div>
              <div className="text-[13px] text-muted xl:hidden">plus {p.gstRateBp / 100}% GST</div>
            </Td>
            <Td className={cx(WIDE_ONLY, "tabular whitespace-nowrap")}>{p.gstRateBp / 100}%</Td>
            <Td className="tabular whitespace-nowrap text-[13px]">
              {formatCount(p.studentCap)} students
              <div className="text-muted">{formatCount(p.staffCap)} staff</div>
            </Td>
            <Td className={cx(WIDE_ONLY, "tabular whitespace-nowrap text-[13px] text-muted")}>
              <span title={p.modules.map((m) => MODULE_LABEL[m] ?? m).join(", ")}>
                {p.modules.length} of {moduleCount}
              </span>
            </Td>
            <Td className="tabular whitespace-nowrap">{formatCount(p.institutes)}</Td>
            <Td>
              {canEdit && (
                <div className="flex items-center justify-end gap-4 whitespace-nowrap">
                  <Link href={`/platform/plans/${p.id}`} className="text-[13px] font-medium text-brand hover:underline">
                    Edit
                  </Link>
                  {p.archivedAt ? (
                    <ActionForm action={restorePlanAction}>
                      <input type="hidden" name="planId" value={p.id} />
                      <SubmitButton size="sm" variant="quiet" pendingText="Restoring…">
                        Restore
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <ActionForm
                      action={archivePlanAction}
                      confirm={`Archive ${p.name}? It can't be chosen for new licences, and licences on it don't renew automatically. ${p.institutes ? `The ${plural(p.institutes, "institute")} on it keep${p.institutes === 1 ? "s" : ""} it.` : ""}`}
                    >
                      <input type="hidden" name="planId" value={p.id} />
                      <SubmitButton size="sm" variant="quiet" pendingText="Archiving…">
                        Archive
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {p.institutes === 0 && (
                    <ActionForm action={deletePlanAction} confirm={`Delete ${p.name}? This can't be undone.`}>
                      <input type="hidden" name="planId" value={p.id} />
                      <SubmitButton size="sm" variant="quiet" pendingText="Deleting…">
                        Delete
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
            </Td>
          </tr>
        ))}
      </PanelTable>

      <p className="mt-4 text-[13px] text-muted">
        {canEdit
          ? "Existing licences keep their price until they renew; renewals use the plan's price on the day they renew. A discount is given on the licence, not the plan."
          : "Only a Super Admin can add, change or archive plans."}
      </p>
    </>
  );
}
