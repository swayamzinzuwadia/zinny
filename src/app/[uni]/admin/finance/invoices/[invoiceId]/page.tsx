import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { InvoiceStatusBadge } from "@/modules/payments/components/status-badge";
import { cancelInvoiceAction, markUnpaidAction, recordPaymentAction } from "@/modules/payments/invoice-actions";
import { orderIdOfInvoice } from "@/modules/payments/invoice-register";
import { MODE_LABEL, getManualInvoice } from "@/modules/payments/manual-invoices";
import { amount, inr, stateLabel } from "@/modules/payments/money";
import { invoiceDate } from "@/modules/payments/pdf/invoice-pdf";
import { PAYMENT_MODES } from "@/modules/payments/schema";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

const HISTORY: Record<string, string> = {
  "manual_invoice.create": "Invoice created",
  "manual_invoice.update": "Invoice edited",
  "manual_invoice.paid": "Payment recorded",
  "manual_invoice.unpaid": "Marked unpaid",
  "manual_invoice.cancel": "Invoice cancelled",
};

function historyDetail(action: string, data: Record<string, unknown>) {
  if (action === "manual_invoice.paid") {
    const mode = MODE_LABEL[data.mode as keyof typeof MODE_LABEL] ?? String(data.mode ?? "");
    return `${mode}${data.reference ? `, reference ${String(data.reference)}` : ""}${data.paidOn ? `, on ${invoiceDate(String(data.paidOn))}` : ""}`;
  }
  if (action === "manual_invoice.cancel") return String(data.reason ?? "");
  if (action === "manual_invoice.update") {
    const before = data.before as { totalPaise?: number; dueDate?: string | null; issueDate?: string } | undefined;
    const after = data.after as { totalPaise?: number; dueDate?: string | null; issueDate?: string } | undefined;
    const parts: string[] = [];
    if (before && after) {
      if (before.totalPaise !== after.totalPaise) parts.push(`total ${inr(before.totalPaise ?? 0)} to ${inr(after.totalPaise ?? 0)}`);
      if (before.dueDate !== after.dueDate) parts.push(`due date ${before.dueDate ? invoiceDate(before.dueDate) : "none"} to ${after.dueDate ? invoiceDate(after.dueDate) : "none"}`);
      if (before.issueDate !== after.issueDate && before.issueDate && after.issueDate) parts.push(`invoice date ${invoiceDate(before.issueDate)} to ${invoiceDate(after.issueDate)}`);
    }
    return parts.length ? `Changed ${parts.join(", ")}` : "Lines or notes changed";
  }
  if (action === "manual_invoice.unpaid") return "The recorded payment was taken back";
  return "";
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ uni: string; invoiceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { uni, invoiceId } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin/finance/invoices`;
  if (!can(actor, "finance.view", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Invoice" />
        <Empty title="You don't have access to Invoices">Your role doesn&apos;t include Finance. Ask an Institute Admin if you need it.</Empty>
      </>
    );
  }
  const d = await getManualInvoice(actor, invoiceId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!d) {
    // An order invoice opens on its order in Sales.
    const orderId = await orderIdOfInvoice(actor, invoiceId);
    if (orderId) redirect(`/${uni}/admin/finance/sales?order=${orderId}`);
    notFound();
  }
  const i = d.invoice;
  const gst = i.cgstPaise + i.sgstPaise + i.igstPaise;
  const title = i.gstApplied ? "Tax invoice" : "Invoice";

  return (
    <>
      <PageHeader
        title={`Invoice ${i.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={i.status} overdue={d.overdue} />
            <span>
              {d.category.name} · {i.buyerName} · {inr(i.totalPaise)}
            </span>
          </span>
        }
        actions={
          <>
            <Link href={base} className={buttonClass("ghost", "sm")}>
              All invoices
            </Link>
            {d.canManage && i.status === "unpaid" && (
              <Link href={`${base}/${i.id}/edit`} className={buttonClass("secondary", "sm")}>
                Edit invoice
              </Link>
            )}
            {/* Plain link: it opens a file. */}
            <a href={`${base}/${i.id}/pdf`} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
              Download PDF
            </a>
          </>
        }
      />

      {sp.created === "1" && (
        <div className="mb-6">
          <Notice tone="brand">
            Invoice {i.number} is issued.{i.userId ? ` ${i.buyerName} has been notified and can see it under Invoices.` : " Download the PDF to send it."}
          </Notice>
        </div>
      )}
      {sp.saved === "1" && (
        <div className="mb-6">
          <Notice tone="brand">Changes saved.</Notice>
        </div>
      )}
      {d.overdue && (
        <div className="mb-6">
          <Notice tone="gold">
            This invoice was due on {invoiceDate(i.dueDate!)} and hasn&apos;t been paid. Record the payment when it comes in, or follow up with {i.buyerName}.
          </Notice>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className={cx("p-0", i.status === "cancelled" && "opacity-80")}>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5 sm:px-8">
            <div>
              <div className="text-[22px] font-semibold leading-tight">{title}</div>
              <div className="mt-1 text-[13px] text-muted">{d.category.name}{d.category.archived ? " (archived category)" : ""}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[15px] font-semibold">{i.number}</div>
              <div className="mt-1 text-[13px] text-muted">Date {invoiceDate(i.issueDate)}</div>
              {i.dueDate && <div className={cx("text-[13px]", d.overdue ? "font-medium text-gold-strong" : "text-muted")}>Due {invoiceDate(i.dueDate)}</div>}
            </div>
          </div>

          <div className="grid gap-6 border-b border-line px-6 py-5 text-[14px] sm:grid-cols-2 sm:px-8">
            <div>
              <div className="text-[12.5px] text-muted">From</div>
              <div className="mt-1 font-medium">{i.sellerName}</div>
              {i.sellerAddress && <div className="whitespace-pre-line text-muted">{i.sellerAddress}</div>}
              <div className="text-muted">State: {stateLabel(i.sellerStateCode)}</div>
              {i.gstApplied && <div className="text-muted">GSTIN: {i.sellerGstin ?? "not registered"}</div>}
            </div>
            <div>
              <div className="text-[12.5px] text-muted">Bill to</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-medium">
                {i.buyerName}
                {i.userId && <Badge>Has an account</Badge>}
              </div>
              {i.buyerEmail && <div className="text-muted">{i.buyerEmail}</div>}
              {i.buyerPhone && <div className="text-muted">{i.buyerPhone}</div>}
              {i.buyerAddress && <div className="whitespace-pre-line text-muted">{i.buyerAddress}</div>}
              {i.gstApplied && (
                <>
                  {i.buyerGstin && <div className="text-muted">GSTIN: {i.buyerGstin}</div>}
                  <div className="text-muted">Place of supply: {stateLabel(i.placeOfSupply)}</div>
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto px-6 py-5 sm:px-8">
            <table className="w-full min-w-[480px] text-left text-[14px]">
              <thead className="text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th className="w-8 py-2 font-normal">#</th>
                  <th className="py-2 font-normal">Description</th>
                  {i.gstApplied && <th className="py-2 font-normal">SAC</th>}
                  <th className="py-2 text-right font-normal">Qty</th>
                  <th className="py-2 text-right font-normal">Rate (₹)</th>
                  <th className="py-2 text-right font-normal">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 text-muted">{l.position}</td>
                    <td className="py-2.5 font-medium">{l.description}</td>
                    {i.gstApplied && <td className="py-2.5 font-mono text-[13px] text-muted">{i.sacCode}</td>}
                    <td className="tabular py-2.5 text-right">{l.quantity}</td>
                    <td className="tabular py-2.5 text-right">{amount(l.unitPricePaise)}</td>
                    <td className="tabular py-2.5 text-right">{amount(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="ml-auto mt-5 w-full max-w-xs space-y-1.5 text-[14px]">
              {i.discountPaise > 0 && (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Subtotal</dt>
                    <dd className="tabular">{amount(i.subtotalPaise)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">
                      Discount{i.discountNote && <span className="block text-[12px]">{i.discountNote}</span>}
                    </dt>
                    <dd className="tabular">−{amount(i.discountPaise)}</dd>
                  </div>
                </>
              )}
              {i.gstApplied && (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Taxable value</dt>
                    <dd className="tabular">{amount(i.taxablePaise)}</dd>
                  </div>
                  {i.igstPaise > 0 || i.placeOfSupply !== i.sellerStateCode ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">IGST @ {pct(i.gstRateBp / 100)}</dt>
                      <dd className="tabular">{amount(i.igstPaise)}</dd>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">CGST @ {pct(i.gstRateBp / 200)}</dt>
                        <dd className="tabular">{amount(i.cgstPaise)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">SGST @ {pct(i.gstRateBp / 200)}</dt>
                        <dd className="tabular">{amount(i.sgstPaise)}</dd>
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="flex justify-between gap-4 border-t border-line pt-2 text-[17px] font-semibold">
                <dt>Total (₹)</dt>
                <dd className={cx("tabular", i.status === "cancelled" && "line-through")}>{amount(i.totalPaise)}</dd>
              </div>
              {i.gstApplied && gst === 0 && <p className="text-[12.5px] text-muted">GST at 0%: nothing is added.</p>}
            </dl>
          </div>

          {i.notes && (
            <div className="border-t border-line px-6 py-5 sm:px-8">
              <div className="text-[12.5px] text-muted">Notes</div>
              <p className="mt-1 whitespace-pre-line text-[14px]">{i.notes}</p>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <CardTitle>Payment</CardTitle>
            {i.status === "paid" && (
              <>
                <dl className="space-y-2 text-[14px]">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Paid on</dt>
                    <dd>{i.paidOn ? invoiceDate(i.paidOn) : "–"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Paid by</dt>
                    <dd>{i.paymentMode ? MODE_LABEL[i.paymentMode] : "–"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Reference</dt>
                    <dd className="break-all text-right font-mono text-[13px]">{i.paymentReference ?? "–"}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[13px] text-muted">A paid invoice is locked. Mark it unpaid to change it, for example when a cheque bounces.</p>
                {d.canManage && (
                  <ActionForm action={markUnpaidAction} className="mt-3" confirm={`Mark invoice ${i.number} unpaid? The recorded payment is removed.`}>
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="invoiceId" value={i.id} />
                    <SubmitButton variant="secondary" size="sm" pendingText="Marking unpaid…">
                      Mark unpaid
                    </SubmitButton>
                  </ActionForm>
                )}
              </>
            )}
            {i.status === "cancelled" && (
              <dl className="space-y-2 text-[14px]">
                <div>
                  <dt className="text-muted">Cancelled{i.cancelledAt ? ` on ${invoiceDate(i.cancelledAt.toISOString().slice(0, 10))}` : ""}</dt>
                  <dd className="mt-0.5">{i.cancelReason}</dd>
                </div>
                <p className="text-[13px] text-muted">Nothing is payable. The invoice keeps its number and stays in the list.</p>
              </dl>
            )}
            {i.status === "unpaid" &&
              (d.canManage ? (
                <ActionForm action={recordPaymentAction} className="space-y-4" resetOnSuccess={false}>
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="invoiceId" value={i.id} />
                  <p className="text-[14px]">
                    <span className="tabular font-semibold">{inr(i.totalPaise)}</span> <span className="text-muted">to collect{i.dueDate ? ` by ${invoiceDate(i.dueDate)}` : ""}.</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Paid on">
                      <Input type="date" name="paidOn" defaultValue={d.today} min={i.issueDate} max={d.today} required />
                    </Field>
                    <Field label="Paid by">
                      <Select name="mode" defaultValue="upi">
                        {PAYMENT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Reference" hint="UPI transaction id, bank UTR or cheque number. Optional for cash and card.">
                    <Input name="reference" maxLength={80} className="font-mono" />
                  </Field>
                  <SubmitButton pendingText="Recording…">Record payment</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-[14px] text-muted">
                  {inr(i.totalPaise)} is unpaid{i.dueDate ? `, due ${invoiceDate(i.dueDate)}` : ""}. Only Accounts &amp; Fees and Institute Admins can record a payment.
                </p>
              ))}
          </Card>

          {d.canManage && i.status === "unpaid" && (
            <Card className="p-5">
              <CardTitle>Cancel this invoice</CardTitle>
              <ActionForm action={cancelInvoiceAction} className="space-y-3" confirm={`Cancel invoice ${i.number}? This can't be undone.`}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="invoiceId" value={i.id} />
                <Field label="Reason" hint="Shown in the list and on the PDF. The number isn't reused.">
                  <Input name="reason" required minLength={3} maxLength={200} placeholder="Raised twice by mistake" />
                </Field>
                <SubmitButton variant="danger" size="sm" pendingText="Cancelling…">
                  Cancel invoice
                </SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card className="p-5">
            <CardTitle>History</CardTitle>
            {d.history.length === 0 ? (
              <p className="text-[14px] text-muted">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-3 text-[14px]">
                {d.history.map((h, n) => {
                  const detail = historyDetail(h.action, h.data);
                  return (
                    <li key={n} className="flex gap-3">
                      <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n === 0 ? "bg-brand" : "bg-line")} aria-hidden />
                      <div className="min-w-0">
                        <div className="font-medium">{HISTORY[h.action] ?? h.action}</div>
                        {detail && <div className="text-[13px] text-muted">{detail}</div>}
                        <div className="text-[12.5px] text-muted">
                          {new Intl.DateTimeFormat("en-IN", { timeZone: university.timezone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(h.at)}
                          {h.by ? ` · ${h.by}` : ""}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
