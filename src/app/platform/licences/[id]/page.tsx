import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { acknowledgeAlertAction, saveLicenceAction } from "@/modules/zinny-team-panel/actions";
import { Fact, NoAccess, RenewalText, StatusBadge, UsageMeter } from "@/modules/zinny-team-panel/components/bits";
import { LicenceFields } from "@/modules/zinny-team-panel/components/licence-fields";
import { CAP_WARNING_RATIO, DEFAULT_PAYMENT_DAYS, END_WARNING_DAYS, zinnySeller } from "@/modules/zinny-team-panel/lib/constants";
import { formatDate, formatDateTime, formatINR, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { licenceDefaults } from "@/modules/zinny-team-panel/lib/licence";
import { licenceFor } from "@/modules/zinny-team-panel/services/licences";

export const metadata = { title: "Licence" };

export default async function LicencePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Licences" />;
  const { id } = await params;
  const data = await licenceFor(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { university: u, licence: l, usage, alerts, plans, invoices } = data;
  const today = todayIST();
  const canFinance = canPlatform(actor, "platform.finance");
  // A new licence starts on Standard when there is one, otherwise on the first plan on offer.
  const first = plans.find((p) => p.key === "standard" && !p.archived) ?? plans.find((p) => !p.archived);
  const initial = l
    ? {
        plan: l.plan,
        studentCap: l.studentCap,
        staffCap: l.staffCap,
        modules: l.modules,
        startDate: l.startDate,
        endDate: l.endDate,
        notes: l.notes ?? "",
        pricePaise: l.pricePaise,
        discountPaise: l.discountPaise,
        discountNote: l.discountNote ?? "",
      }
    : first
      ? licenceDefaults(first, today)
      : null;
  const planName = l ? (plans.find((p) => p.key === l.plan)?.name ?? l.plan) : null;

  return (
    <>
      <PageHeader
        title={`${u.name} licence`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={u.status} />
            {l ? (
              <span>
                Last changed {formatDateTime(l.updatedAt)}. Ends {formatDate(l.endDate)} (<RenewalText daysLeft={data.daysLeft} />)
              </span>
            ) : (
              <span>No licence yet. Usage and renewals are tracked once you save one.</span>
            )}
          </span>
        }
        actions={
          canPlatform(actor, "platform.manage_universities") ? (
            <Link href={`/platform/institutes/${u.id}`} className="inline-flex h-10 items-center whitespace-nowrap rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
              Institute details
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardTitle hint={l ? "Renewing or changing the plan raises an invoice" : "Saving raises the first invoice"}>{l ? "Edit licence" : "Set up licence"}</CardTitle>
          {initial ? (
            <ActionForm action={saveLicenceAction} resetOnSuccess={false} className="space-y-5">
              <input type="hidden" name="universityId" value={u.id} />
              <LicenceFields
                // A saved licence starts the form again from what was saved.
                key={l ? l.updatedAt.toISOString() : "new"}
                plans={plans}
                initial={initial}
                existing={!!l}
                charge={{ invoiceDate: today, paymentDays: DEFAULT_PAYMENT_DAYS, intraState: u.stateCode === zinnySeller().stateCode }}
              />
              <SubmitButton pendingText="Saving…">{l ? "Save licence" : "Create licence"}</SubmitButton>
            </ActionForm>
          ) : (
            <Notice tone="warn">
              Every plan is archived, so there is nothing to put this institute on.{" "}
              <Link href="/platform/plans" className="font-medium underline underline-offset-2">
                Restore a plan or create one
              </Link>
              .
            </Notice>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {l && (
            <Card>
              <CardTitle hint={<Link href="/platform/plans" className="hover:text-brand">Plans</Link>}>Plan and price</CardTitle>
              <dl className="grid grid-cols-2 gap-4">
                <Fact label="Plan">
                  <Badge>{planName}</Badge>
                </Fact>
                <Fact label="List price">{l.pricePaise === 0 ? "Free" : formatINR(l.pricePaise)}</Fact>
                <Fact label="Discount">
                  {l.discountPaise > 0 ? (
                    <>
                      {formatINR(l.discountPaise)}
                      {l.discountNote && <div className="text-[12.5px] text-muted">{l.discountNote}</div>}
                    </>
                  ) : (
                    "None"
                  )}
                </Fact>
                <Fact label="Net before GST">{formatINR(l.pricePaise - l.discountPaise)}</Fact>
              </dl>
              <p className="mt-4 text-[12.5px] text-muted">The price was copied from the plan when this licence was priced. Changing the plan later doesn&apos;t change it.</p>
            </Card>
          )}

          <Card>
            <CardTitle hint="People with an active role right now">Usage</CardTitle>
            <div className="space-y-4">
              <UsageMeter label="Students" used={usage.students} cap={l?.studentCap ?? null} />
              <UsageMeter label="Staff" used={usage.staff} cap={l?.staffCap ?? null} />
            </div>
            <p className="mt-4 text-[12.5px] text-muted">
              Students hold the student role. Staff hold an administration or teaching role. A person with several roles counts once.
            </p>
          </Card>

          <Card>
            <CardTitle hint={invoices.length ? `${invoices.length} raised` : undefined}>Invoices for this licence</CardTitle>
            {invoices.length === 0 ? (
              <p className="text-[14px] text-muted">No invoice has been raised for this licence yet. One is created when you set it up, renew it or change its plan.</p>
            ) : (
              <ul className="divide-y divide-line text-[14px]">
                {invoices.map((i) => (
                  <li key={i.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {canFinance ? (
                        <Link href={`/platform/billing/${i.id}`} className="tabular whitespace-nowrap text-[13px] font-medium text-ink hover:text-brand">
                          {i.number}
                        </Link>
                      ) : (
                        <span className="tabular whitespace-nowrap text-[13px] font-medium">{i.number}</span>
                      )}
                      <span className="tabular font-medium">{formatINR(i.totalPaise)}</span>
                      {i.status === "paid" ? (
                        <Badge tone="brand">Paid {formatDate(i.paidOn, { year: false })}</Badge>
                      ) : i.overdue ? (
                        <Badge tone="danger">Overdue since {formatDate(i.dueDate, { year: false })}</Badge>
                      ) : (
                        <Badge tone="gold">Due {formatDate(i.dueDate, { year: false })}</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-[12.5px] text-muted">
                      Issued {formatDate(i.issueDate)} · {formatDate(i.periodStart, { year: false })} to {formatDate(i.periodEnd)}
                      {i.discountPaise > 0 && ` · ${formatINR(i.discountPaise)} discount`}
                      {i.revisedAt && " · revised"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Warnings</CardTitle>
            {alerts.length === 0 ? (
              <p className="text-[14px] text-muted">
                No warnings. One appears at {Math.round(CAP_WARNING_RATIO * 100)}% of a cap and {END_WARNING_DAYS} days before the licence ends.
              </p>
            ) : (
              <ul className="space-y-3">
                {alerts.map((a) => (
                  <li key={a.id} className={a.level === "critical" ? "rounded-2xl bg-danger-soft p-4" : "rounded-2xl bg-gold-soft p-4"}>
                    <div className="flex flex-wrap items-start justify-between gap-2 text-[14px]">
                      <div>
                        <div className="font-medium text-ink">{a.title}</div>
                        <div className={a.level === "critical" ? "text-danger" : "text-gold-strong"}>{a.body}</div>
                      </div>
                      {a.acknowledgedAt ? (
                        <Badge>Handled</Badge>
                      ) : (
                        <ActionForm action={acknowledgeAlertAction}>
                          <input type="hidden" name="alertId" value={a.id} />
                          <SubmitButton size="sm" variant="secondary">
                            Mark as handled
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
