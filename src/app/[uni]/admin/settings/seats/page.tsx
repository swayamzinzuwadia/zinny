import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { UsageMeter } from "@/modules/zinny-team-panel/components/bits";
import { SeatPackForm } from "@/modules/zinny-team-panel/components/seat-pack-form";
import { formatDate, formatINR, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { describePacks, PACK_KINDS } from "@/modules/zinny-team-panel/lib/seat-packs";
import { instituteSeats, seatAccess } from "@/modules/zinny-team-panel/services/seat-packs";
import { buyPacksAction, payInvoiceAction } from "./actions";

export const metadata = { title: "Seats" };

export default async function SeatsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!seatAccess(actor).view) notFound();
  const today = todayIST();
  const s = await instituteSeats(actor, today);
  const l = s.licence;
  const unpaid = s.invoices.filter((i) => i.status !== "paid");

  return (
    <>
      <PageHeader
        title="Seats"
        subtitle={l ? `${s.planName} plan, ${formatDate(l.startDate)} to ${formatDate(l.endDate)}. Add more people any time by buying seat packs.` : "Your institute has no Zinny licence yet."}
      />
      {!l ? (
        <Notice tone="neutral">Zinny sets up your licence. Once it is in place, this page shows how many seats you use and lets you add more.</Notice>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardTitle hint="People with an active role right now">Seats in use</CardTitle>
              <div className="space-y-4">
                <UsageMeter label="Students" used={s.usage.students} cap={l.studentCap} />
                <UsageMeter label="Staff" used={s.usage.staff} cap={l.staffCap} />
              </div>
              <ul className="mt-4 space-y-1 text-[13px] text-muted">
                {PACK_KINDS.map((k) => (
                  <li key={k}>
                    {s.held[k].packs > 0
                      ? `Includes ${describePacks(k, s.held[k].packs, s.held[k].seats)} on top of your plan.`
                      : `No ${k} packs yet. One pack adds ${s.pricing[k].size} ${k === "student" ? "students" : "staff"}.`}
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardTitle hint={s.canBuy ? "Seats are added as soon as you buy" : undefined}>Buy seat packs</CardTitle>
              {!s.quote ? (
                <p className="text-[14px] text-muted">Your licence ended on {formatDate(l.endDate)}. Talk to Zinny about renewing it, then add seats here.</p>
              ) : s.canBuy ? (
                <>
                  <p className="mb-4 text-[14px] text-muted">
                    A pack costs its year price for the days left in your licence, to the rupee, plus GST. Packs renew with your licence at the price then.
                  </p>
                  <SeatPackForm action={buyPacksAction} pricing={s.pricing} term={l} today={s.quote.today} gstRateBp={s.quote.gstRateBp} intraState={s.quote.intraState} hidden={{ uni }} mode="institute" />
                </>
              ) : (
                <p className="text-[14px] text-muted">Only an institute admin can buy seat packs.</p>
              )}
            </Card>
          </div>

          <div className="min-w-0 space-y-6">
            <Card>
              <CardTitle hint={unpaid.length ? `${unpaid.length} to pay` : undefined}>Zinny invoices</CardTitle>
              {s.invoices.length === 0 ? (
                <p className="text-[14px] text-muted">No invoices yet.</p>
              ) : (
                <ul className="divide-y divide-line text-[14px]">
                  {s.invoices.map((i) => (
                    <li key={i.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tabular text-[13px] font-medium">{i.number}</span>
                        <span className="tabular font-medium">{formatINR(i.totalPaise)}</span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted">{i.description}</div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        {i.status === "paid" ? (
                          <Badge tone="brand">Paid {formatDate(i.paidOn, { year: false })}</Badge>
                        ) : i.overdue ? (
                          <span className="text-[13px] font-medium text-danger">Overdue since {formatDate(i.dueDate, { year: false })}</span>
                        ) : (
                          <Badge tone="gold">Due {formatDate(i.dueDate)}</Badge>
                        )}
                        {i.status !== "paid" && s.canBuy && s.onlinePayments && (
                          <ActionForm action={payInvoiceAction} confirm={`Pay ${formatINR(i.totalPaise)} for invoice ${i.number}?`}>
                            <input type="hidden" name="uni" value={uni} />
                            <input type="hidden" name="invoiceId" value={i.id} />
                            <SubmitButton size="sm" pendingText="Paying…">
                              {`Pay ${formatINR(i.totalPaise)}`}
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {unpaid.length > 0 && !s.onlinePayments && (
                <p className="mt-4 text-[12.5px] text-muted">Pay by bank transfer quoting the invoice number. Zinny marks the invoice paid when the money arrives.</p>
              )}
              {s.onlinePayments && <p className="mt-4 text-[12.5px] text-muted">Payments here use the test gateway: no money moves.</p>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
