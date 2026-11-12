import { Badge, Card, Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { InvoiceStatusBadge } from "@/modules/payments/components/status-badge";
import { myInvoices, myManualInvoices } from "@/modules/payments/invoices";
import { inr } from "@/modules/payments/money";
import { invoiceDate } from "@/modules/payments/pdf/invoice-pdf";
import { sendParentsHome } from "../view";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const downloadClass =
  "inline-flex h-10 w-full items-center justify-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium text-ink hover:border-brand/40 sm:w-auto";

export default async function InvoicesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  if (!can(actor, "self.view_invoices", { universityId: university.id, ownerUserId: actor.userId })) {
    return (
      <>
        <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Invoices</h1>
        <Empty title="Invoices are for learners">Your account doesn&apos;t buy anything here, so there are no invoices.</Empty>
      </>
    );
  }
  const [orders, raised] = await Promise.all([myInvoices(actor), myManualInvoices(actor)]);
  const toPay = raised.filter((i) => i.status === "unpaid");
  const duePaise = toPay.reduce((n, i) => n + i.totalPaise, 0);
  const anyOverdue = toPay.some((i) => i.overdue);

  // One list, newest first; what still needs paying comes first.
  const all = [
    ...raised.map((i) => ({ kind: "raised" as const, date: i.issuedOn, i })),
    ...orders.map((i) => ({ kind: "order" as const, date: i.issuedOn, i })),
  ].sort((a, b) => {
    const pa = a.kind === "raised" && a.i.status === "unpaid" ? 0 : 1;
    const pb = b.kind === "raised" && b.i.status === "unpaid" ? 0 : 1;
    return pa - pb || b.date.localeCompare(a.date);
  });

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Invoices</h1>
      <p className="mb-5 mt-1 text-[14px] text-muted">
        Invoices from {university.name} for fees, and for what you bought on the marketplace. Download them as PDF for your records or reimbursement.
      </p>

      {toPay.length > 0 && (
        <div className={anyOverdue ? "mb-4 rounded-2xl bg-gold-soft px-4 py-3 text-[14px] text-gold-strong" : "mb-4 rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong"}>
          <span className="tabular font-semibold">{inr(duePaise)}</span> to pay across {toPay.length === 1 ? "1 invoice" : `${toPay.length} invoices`}
          {anyOverdue ? ", some past the due date" : ""}. Pay the institute&apos;s accounts office; it shows as paid here once they record it.
        </div>
      )}

      {all.length === 0 ? (
        <Empty title="No invoices yet">Invoices the institute raises for you, and for marketplace purchases, appear here.</Empty>
      ) : (
        <div className="space-y-3">
          {all.map((row) => {
            if (row.kind === "raised") {
              const i = row.i;
              return (
                <Card key={i.id} className={i.overdue ? "border-gold/60 p-4 sm:p-5" : "p-4 sm:p-5"}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[16px] font-semibold leading-snug">{i.title}</div>
                      <div className="text-[13px] text-muted">{i.category}</div>
                    </div>
                    <div className={i.status === "cancelled" ? "tabular shrink-0 text-right text-[16px] font-semibold text-muted line-through" : "tabular shrink-0 text-right text-[16px] font-semibold"}>
                      {inr(i.totalPaise)}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                    <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
                    <span className="font-mono text-[12.5px] text-ink">{i.number}</span>
                    <span>{invoiceDate(i.issuedOn)}</span>
                    {i.gstPaise > 0 && <span>incl. {inr(i.gstPaise)} GST</span>}
                  </div>
                  {i.status === "unpaid" && i.dueDate && (
                    <div className={i.overdue ? "mt-2 text-[13px] font-medium text-gold-strong" : "mt-2 text-[13px] text-muted"}>
                      {i.overdue ? `Was due on ${invoiceDate(i.dueDate)}` : `Due by ${invoiceDate(i.dueDate)}`}
                    </div>
                  )}
                  {i.status === "paid" && i.paidOn && <div className="mt-2 text-[13px] text-muted">Paid on {invoiceDate(i.paidOn)}</div>}
                  {i.status === "cancelled" && <div className="mt-2 text-[13px] text-muted">Cancelled by the institute. Nothing is payable.</div>}
                  <div className="mt-3">
                    {/* Plain link: it downloads a file, so it must not be prefetched. */}
                    <a href={`/${uni}/learn/invoices/${i.id}`} className={downloadClass}>
                      Download PDF
                    </a>
                  </div>
                </Card>
              );
            }
            const i = row.i;
            const fully = i.orderStatus === "refunded" || i.refundedPaise >= i.totalPaise;
            return (
              <Card key={i.id} className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[16px] font-semibold leading-snug">{i.course}</div>
                    <div className="text-[13px] text-muted">{i.batch}</div>
                  </div>
                  <div className="tabular shrink-0 text-right text-[16px] font-semibold">{inr(i.totalPaise)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                  <InvoiceStatusBadge status="paid" />
                  <span className="font-mono text-[12.5px] text-ink">{i.number}</span>
                  <span>{invoiceDate(i.issuedOn)}</span>
                  {i.gstPaise > 0 && <span>incl. {inr(i.gstPaise)} GST</span>}
                </div>
                {(i.refundedPaise > 0 || i.refundInFlightPaise > 0) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                    {fully ? <Badge>Refunded</Badge> : i.refundedPaise > 0 ? <Badge>Partly refunded</Badge> : null}
                    {i.refundedPaise > 0 && <span className="text-muted">{inr(i.refundedPaise)} refunded</span>}
                    {i.refundInFlightPaise > 0 && <span className="text-muted">{inr(i.refundInFlightPaise)} refund on its way</span>}
                  </div>
                )}
                <div className="mt-3">
                  {/* Plain link: it downloads a file, so it must not be prefetched. */}
                  <a href={`/${uni}/learn/invoices/${i.id}`} className={downloadClass}>
                    Download PDF
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
