import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { platformContext } from "@/server/context";
import { runBillingNowAction, saveBillingSettingsAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { formatDateTime } from "@/modules/zinny-team-panel/lib/format";
import { canManageBillingSettings, canSeeSeatPacks, getBillingSettings, getSeatPackSettings } from "@/modules/zinny-team-panel/services/billing-settings";
import Link from "next/link";
import { canPlatform } from "@/server/core";
import { PackTermsForm } from "@/modules/zinny-team-panel/components/pack-terms-form";
import { formatINR } from "@/modules/zinny-team-panel/lib/format";
import { allPlans } from "@/modules/zinny-team-panel/services/plans";
import { planPackSummary } from "@/modules/zinny-team-panel/services/seat-packs";
import { saveSeatPackSettingsAction } from "./seat-actions";

export const metadata = { title: "Billing settings" };

export default async function BillingSettingsPage() {
  const actor = await platformContext();
  const manage = canManageBillingSettings(actor);
  const seeSeats = canSeeSeatPacks(actor);
  if (!manage && !seeSeats) return <NoAccess section="Billing settings" />;
  const s = manage ? await getBillingSettings(actor) : null;
  const superAdmin = isSuperAdmin(actor);
  const packs = seeSeats ? await getSeatPackSettings(actor) : null;
  const ownPacks = seeSeats ? planPackSummary(await allPlans()) : [];
  const editPacks = canPlatform(actor, "platform.seat_pricing");

  return (
    <>
      <PageHeader
        title="Billing settings"
        subtitle="How Zinny invoices institutes: payment terms, automatic renewals and payment reminders. Billing runs by itself every day just after midnight."
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
        {s && (
        <Card className="min-w-0 p-6">
          <ActionForm action={saveBillingSettingsAction} resetOnSuccess={false} className="space-y-6">
            <Section title="Invoices">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Payment terms (days)" hint="From the invoice date to the due date">
                  <Input name="paymentDays" inputMode="numeric" defaultValue={s.paymentDays} required />
                </Field>
              </div>
            </Section>

            <Section title="Renewals">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Renew this many days before a licence ends" hint="The renewal invoice goes out then">
                  <Input name="renewalLeadDays" inputMode="numeric" defaultValue={s.renewalLeadDays} required />
                </Field>
              </div>
              <Check name="autoRenewDefault" checked={s.autoRenewDefault} label="New licences renew automatically" hint="Ticks Renew automatically on a new licence. It can be turned off on each licence." />
              <Check
                name="keepDiscountOnRenewal"
                checked={s.keepDiscountOnRenewal}
                label="Keep a licence's discount when it renews"
                hint="Off: renewals are invoiced at the plan's full price."
              />
              <p className="text-[13px] text-muted">A renewal is priced at the plan&apos;s price on the day it renews. A licence on an archived plan isn&apos;t renewed; it gets a warning to pick a plan instead.</p>
            </Section>

            <Section title="Payment reminders">
              <Check name="remindersOn" checked={s.remindersOn} label="Send payment reminders" hint="To the institute's admins, in Zinny and by email, for unpaid invoices." />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Days before the due date" hint="0 for no early reminder">
                  <Input name="remindDaysBefore" inputMode="numeric" defaultValue={s.remindDaysBefore} />
                </Field>
              </div>
              <Check name="remindOnDueDate" checked={s.remindOnDueDate} label="Remind on the due date" />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Overdue: remind every (days)" hint="After the due date">
                  <Input name="remindEveryDaysAfter" inputMode="numeric" defaultValue={s.remindEveryDaysAfter} required />
                </Field>
                <Field label="Overdue reminders, at most" hint="0 for none after the due date">
                  <Input name="maxOverdueReminders" inputMode="numeric" defaultValue={s.maxOverdueReminders} />
                </Field>
              </div>
              <p className="text-[13px] text-muted">Each reminder is sent once and shows in the invoice&apos;s history. Changing an invoice&apos;s due date starts its reminders again.</p>
            </Section>

            <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
              <SubmitButton pendingText="Saving…">Save billing settings</SubmitButton>
              <span className="text-[13px] text-muted">{s.updatedAt ? `Last changed ${formatDateTime(s.updatedAt)}` : "Using Zinny's defaults"}</span>
            </div>
          </ActionForm>
        </Card>
        )}

        <div className="min-w-0 space-y-4">
        {packs && (
          <Card id="seat-packs" className="min-w-0 scroll-mt-24">
            <CardTitle hint={packs.updatedAt ? `Last changed ${formatDateTime(packs.updatedAt)}` : "Zinny's defaults"}>Seat packs</CardTitle>
            <p className="mb-4 text-[14px] text-muted">
              Institutes add users mid-term in packs. A pack bought part-way through a term pays for the days left, to the rupee, plus GST. Packs renew with the licence at the price then. A plan can set its own.
            </p>
            <PackTermsForm action={saveSeatPackSettingsAction} values={packs} canEdit={editPacks} submitLabel="Save seat packs" />
            {ownPacks.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-[13px] font-medium">Plans with their own packs</h3>
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {ownPacks.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/platform/plans/${p.id}`} className="font-medium text-ink hover:text-brand">
                        {p.name}
                      </Link>
                      <span className="tabular text-muted">
                        Students {p.studentPackSize ?? packs.studentPackSize} for {formatINR(p.studentPackPricePaise ?? packs.studentPackPricePaise)} · staff {p.staffPackSize ?? packs.staffPackSize} for{" "}
                        {formatINR(p.staffPackPricePaise ?? packs.staffPackPricePaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {superAdmin && (
          <Card className="min-w-0">
            <CardTitle>Run billing now</CardTitle>
            <p className="text-[14px] text-muted">
              Does what the daily run does, for every institute, straight away: renews licences that are due and sends the reminders due today. Nothing is renewed or sent twice.
            </p>
            <ActionForm action={runBillingNowAction} className="mt-4">
              <SubmitButton variant="secondary" pendingText="Running…">
                Run billing now
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-[16px] font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Check({ name, checked, label, hint }: { name: string; checked: boolean; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-[14px]">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1 h-4 w-4 accent-[#0b5e4c]" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}
