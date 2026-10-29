import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, Notice, Textarea } from "@/components/ui";
import { refundAction } from "../actions";
import { dayIn } from "../internal";
import { decimal, inr } from "../money";
import { invoiceDate } from "../pdf/invoice-pdf";
import type { orderDetail } from "../sales";
import { RefundStatusBadge, SalesStatusBadge } from "./status-badge";

type Detail = Awaited<ReturnType<typeof orderDetail>>;

const when = (tz: string, d: Date) => `${invoiceDate(dayIn(tz, d))}, ${new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d)}`;

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={mono ? "min-w-0 break-all text-right font-mono text-[12.5px]" : "tabular text-right"}>{children}</dd>
    </div>
  );
}

/** Sales order panel: amounts, payment ids, invoice, refund history and the refund form. */
export function OrderPanel({ uni, d, closeHref }: { uni: string; d: Detail; closeHref: string }) {
  const o = d.order;
  const gst = d.invoice ? { cgst: d.invoice.cgstPaise, sgst: d.invoice.sgstPaise, igst: d.invoice.igstPaise } : null;
  const tookMoney = ["paid", "refund_due", "refunded"].includes(o.status);
  return (
    <Card className="space-y-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-semibold">{o.studentName}</h2>
          <div className="truncate text-[13px] text-muted">{o.studentEmail}</div>
        </div>
        <Link href={closeHref} className="shrink-0 text-[13px] text-muted hover:text-ink">
          Close
        </Link>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <SalesStatusBadge status={o.display} />
          <span className="text-[13px] text-muted">
            {o.course} · {o.batch}
          </span>
        </div>
        <dl className="mt-3 text-[14px]">
          <Row label="Course fee">{inr(o.basePaise)}</Row>
          {gst && gst.igst > 0 ? (
            <Row label="IGST">{inr(gst.igst)}</Row>
          ) : (
            <>
              <Row label="CGST">{inr(gst ? gst.cgst : Math.floor(o.gstPaise / 2))}</Row>
              <Row label="SGST">{inr(gst ? gst.sgst : o.gstPaise - Math.floor(o.gstPaise / 2))}</Row>
            </>
          )}
          <div className="mt-1 border-t border-line pt-1 font-semibold">
            <Row label="Total">{inr(o.totalPaise)}</Row>
          </div>
          {tookMoney && (
            <>
              <Row label="Refunded">{inr(d.totals.processedPaise)}</Row>
              {d.totals.inFlightPaise > 0 && <Row label="Refund on its way">{inr(d.totals.inFlightPaise)}</Row>}
              <Row label="Net">{inr(o.totalPaise - d.totals.processedPaise)}</Row>
            </>
          )}
        </dl>
      </div>

      <div>
        <h3 className="mb-1.5 text-[14px] font-medium">Payment</h3>
        <dl className="text-[14px]">
          <Row label="Created">{when(d.timezone, o.createdAt)}</Row>
          {o.paidAt && <Row label="Paid">{when(d.timezone, o.paidAt)}</Row>}
          <Row label="Gateway">{o.gateway === "mock" ? "Test mode" : o.gateway === "razorpay" ? "Razorpay" : o.gateway}</Row>
          <Row label="Gateway order" mono>
            {o.gatewayOrderId ?? "–"}
          </Row>
          <Row label="Payment id" mono>
            {o.gatewayPaymentId ?? "–"}
          </Row>
          <Row label="Zinny order" mono>
            {o.id}
          </Row>
        </dl>
      </div>

      <div>
        <h3 className="mb-1.5 text-[14px] font-medium">GST invoice</h3>
        {d.invoice ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
            <span>
              <span className="font-mono text-[13px]">{d.invoice.number}</span>
              <span className="text-muted"> · {invoiceDate(dayIn(d.timezone, d.invoice.issuedAt))}</span>
            </span>
            <a href={`/${uni}/admin/finance/sales/invoices/${d.invoice.id}`} className="font-medium text-brand hover:underline">
              Download PDF
            </a>
          </div>
        ) : (
          <p className="text-[14px] text-muted">{o.status === "refund_due" ? "No invoice: the student wasn't enrolled." : "Issued when the order is paid."}</p>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-[14px] font-medium">Refunds</h3>
        {d.refunds.length === 0 ? (
          <p className="text-[14px] text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-[14px]">
            {d.refunds.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular font-medium">{inr(r.amountPaise)}</span>
                  <RefundStatusBadge status={r.status} />
                </div>
                <div className="mt-0.5 text-[13px]">{r.reason}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  {when(d.timezone, r.createdAt)} · {r.requestedByName ?? "Razorpay dashboard"}
                  {r.gatewayRefundId && <span className="font-mono"> · {r.gatewayRefundId}</span>}
                </div>
                {r.failureReason && r.status !== "processed" && <div className="mt-0.5 text-[12.5px] text-danger">{r.failureReason}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {d.can.refund && (
        <div className="rounded-2xl border border-line p-4">
          <h3 className="text-[14px] font-medium">Refund this order</h3>
          {o.status === "refund_due" ? (
            <p className="mt-1 text-[13px] text-muted">This student paid after the batch filled up and wasn&apos;t enrolled. Refund the full amount.</p>
          ) : (
            <p className="mt-1 text-[13px] text-muted">Refunding doesn&apos;t remove the student from the batch. Up to {inr(d.refundablePaise)} can be refunded.</p>
          )}
          <ActionForm
            action={refundAction}
            className="mt-3 space-y-3"
            confirm={`Send this refund to ${o.studentName}? A refund can't be undone.`}
          >
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="orderId" value={o.id} />
            <Field label="Amount in rupees" hint={`Full amount: ${decimal(d.refundablePaise)}`}>
              <Input name="amount" inputMode="decimal" defaultValue={decimal(d.refundablePaise)} required />
            </Field>
            <Field label="Reason" hint="The student sees this in their notification.">
              <Textarea name="reason" required minLength={5} maxLength={500} placeholder="Batch filled before payment finished" />
            </Field>
            <SubmitButton variant="danger" pendingText="Sending refund…">
              Send refund
            </SubmitButton>
          </ActionForm>
        </div>
      )}
      {!d.can.refund && tookMoney && d.refundablePaise > 0 && d.can.manage === false && (
        <Notice tone="neutral">Only Accounts &amp; Fees and Institute Admins can send refunds.</Notice>
      )}

      {d.webhooks.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted">Razorpay webhooks ({d.webhooks.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {d.webhooks.map((w) => (
              <li key={w.id} className="flex justify-between gap-3">
                <span>
                  <span className="font-mono">{w.eventType}</span> <span className="text-muted">{w.outcome ?? w.status}</span>
                  {w.attempts > 1 && <span className="text-muted"> · {w.attempts} tries</span>}
                </span>
                <span className="shrink-0 text-muted">{when(d.timezone, w.receivedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
