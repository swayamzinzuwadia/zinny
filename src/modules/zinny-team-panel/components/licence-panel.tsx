import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Notice } from "@/components/ui";
import { canPlatform, type Actor } from "@/server/core";
import { acknowledgeAlertAction, saveLicenceAction } from "../actions";
import { CAP_WARNING_RATIO, END_WARNING_DAYS, zinnySeller } from "../lib/constants";
import { formatDate, formatINR, todayIST } from "../lib/format";
import { licenceDefaults } from "../lib/licence";
import { licenceFormSettings } from "../services/billing-settings";
import type { licenceFor } from "../services/licences";
import { Fact, UsageMeter } from "./bits";
import { SeatPacksCard } from "./seat-packs-card";
import { seatPacksFor } from "../services/seat-packs";
import { LicenceFields } from "./licence-fields";

/**
 * An institute's licence: the form to set it up or change it, with its price, usage, invoices
 * and warnings beside it. Shown on the institute's own page (its Licence tab), and on the
 * licence page for people who look after licences without the Institutes section.
 */
/** `seatActions` are the licence page's server actions for seat packs and caps (they live with the route). */
export async function LicencePanel({ actor, data, seatActions }: { actor: Actor; data: Awaited<ReturnType<typeof licenceFor>>; seatActions: Parameters<typeof SeatPacksCard>[0]["actions"] }) {
  const { university: u, licence: l, usage, alerts, plans, invoices } = data;
  const settings = await licenceFormSettings(actor);
  const today = todayIST();
  const canFinance = canPlatform(actor, "platform.finance");
  const seats = l ? await seatPacksFor(actor, u.id, today) : null;
  const licencePlan = l ? plans.find((p) => p.key === l.plan) : undefined;
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
        autoRenew: l.autoRenew,
      }
    : first
      ? licenceDefaults(first, today)
      : null;
  const planName = l ? (plans.find((p) => p.key === l.plan)?.name ?? l.plan) : null;

  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-[1.3fr_1fr]">
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
              charge={{
                invoiceDate: today,
                ...settings,
                intraState: u.stateCode === zinnySeller().stateCode,
              }}
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
            <CardTitle
              hint={
                <Link href="/platform/plans" className="hover:text-brand">
                  Plans
                </Link>
              }
            >
              Plan and price
            </CardTitle>
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
              <Fact label="Renews">{l.autoRenew ? `Automatically, ${settings.renewalLeadDays} days before it ends` : "By hand"}</Fact>
            </dl>
            <p className="mt-4 text-[12.5px] text-muted">The price was copied from the plan when this licence was priced. A change to the plan&apos;s price applies from its next renewal.</p>
          </Card>
        )}

        {seats && (
          <SeatPacksCard
            data={seats}
            universityId={u.id}
            today={today}
            gstRateBp={licencePlan?.gstRateBp ?? 1800}
            intraState={u.stateCode === zinnySeller().stateCode}
            canEditCaps={canPlatform(actor, "platform.seat_pricing")}
            canEditPricing={canPlatform(actor, "platform.seat_pricing")}
            actions={seatActions}
          />
        )}

        <Card>
          <CardTitle hint="People with an active role right now">Usage</CardTitle>
          <div className="space-y-4">
            <UsageMeter label="Students" used={usage.students} cap={l?.studentCap ?? null} />
            <UsageMeter label="Staff" used={usage.staff} cap={l?.staffCap ?? null} />
          </div>
          <p className="mt-4 text-[12.5px] text-muted">Students hold the student role. Staff hold an administration or teaching role. A person with several roles counts once.</p>
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
                      <span className="text-[13px] font-medium text-danger">Overdue since {formatDate(i.dueDate, { year: false })}</span>
                    ) : (
                      <Badge>Due {formatDate(i.dueDate, { year: false })}</Badge>
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
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2 text-[14px]">
                    <div className="flex min-w-0 items-start gap-3">
                      <span aria-hidden className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${a.level === "critical" ? "bg-danger" : "bg-gold"}`} />
                      <div>
                        <div className="font-medium text-ink">{a.title}</div>
                        <div className="text-[13px] text-muted">{a.body}</div>
                      </div>
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
  );
}
