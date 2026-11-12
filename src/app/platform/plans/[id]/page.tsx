import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { archivePlanAction, restorePlanAction } from "@/modules/zinny-team-panel/actions";
import { Fact, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { PlanForm } from "@/modules/zinny-team-panel/components/plan-form";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatDateTime, formatINR, plural } from "@/modules/zinny-team-panel/lib/format";
import { getPlan } from "@/modules/zinny-team-panel/services/plans";

export const metadata = { title: "Plan" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Plans" />;
  const { id } = await params;
  const p = await getPlan(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canEdit = isSuperAdmin(actor);

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {p.archivedAt ? <Badge>Archived</Badge> : <Badge tone="brand">On offer</Badge>}
            <span>
              {p.pricePaise === 0 ? "Free" : `${formatINR(p.pricePaise)} before GST`} for {plural(p.billingMonths, "month")} · {plural(p.institutes, "institute")} on it
            </span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardTitle hint="Existing licences and invoices keep their price">Edit plan</CardTitle>
          {canEdit ? <PlanForm plan={p} /> : <p className="text-[14px] text-muted">Only a Super Admin can change plans.</p>}
        </Card>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>About this plan</CardTitle>
            <dl className="grid grid-cols-2 gap-4">
              <Fact label="Key">
                <span className="font-mono text-[13px]">{p.key}</span>
              </Fact>
              <Fact label="Institutes on it">{plural(p.institutes, "institute")}</Fact>
              <Fact label="Created">{formatDateTime(p.createdAt)}</Fact>
              <Fact label="Last changed">{formatDateTime(p.updatedAt)}</Fact>
            </dl>
          </Card>
          {canEdit && (
            <Card>
              <CardTitle>{p.archivedAt ? "Restore" : "Archive"}</CardTitle>
              {p.archivedAt ? (
                <ActionForm action={restorePlanAction} className="space-y-3">
                  <input type="hidden" name="planId" value={p.id} />
                  <p className="text-[14px] text-muted">Archived on {formatDateTime(p.archivedAt)}. Restoring lets it be chosen for new licences again.</p>
                  <SubmitButton variant="secondary">Restore plan</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={archivePlanAction} className="space-y-3" confirm={`Archive ${p.name}?`}>
                  <input type="hidden" name="planId" value={p.id} />
                  <p className="text-[14px] text-muted">
                    An archived plan can&apos;t be chosen for a new licence. Institutes already on it keep it, and their invoices don&apos;t change. You can restore it at any time.
                  </p>
                  <SubmitButton variant="danger">Archive plan</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
