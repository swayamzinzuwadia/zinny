import { Badge, Card, Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { myInvoices } from "@/modules/payments/invoices";
import { inr } from "@/modules/payments/money";
import { invoiceDate } from "@/modules/payments/pdf/invoice-pdf";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

export default async function InvoicesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "self.view_invoices", { universityId: university.id, ownerUserId: actor.userId })) {
    return (
      <>
        <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Invoices</h1>
        <Empty title="Invoices are for learners">Your account doesn&apos;t pay for courses, so there are no invoices here.</Empty>
      </>
    );
  }
  const invoices = await myInvoices(actor);

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Invoices</h1>
      <p className="mb-5 mt-1 text-[14px] text-muted">GST invoices for the courses you paid for. Download them as PDF for your records or reimbursement.</p>
      {invoices.length === 0 ? (
        <Empty title="No invoices yet">When you pay for a course, its GST invoice appears here.</Empty>
      ) : (
        <div className="space-y-3">
          {invoices.map((i) => {
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
                  <span className="font-mono text-[12.5px] text-ink">{i.number}</span>
                  <span>{invoiceDate(i.issuedOn)}</span>
                  <span>incl. {inr(i.gstPaise)} GST</span>
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
                  <a
                    href={`/${uni}/learn/invoices/${i.id}`}
                    className="inline-flex h-10 w-full items-center justify-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium text-ink hover:border-brand/40 sm:w-auto"
                  >
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
