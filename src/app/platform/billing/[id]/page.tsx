import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { markPaidAction, markUnpaidAction } from "@/modules/zinny-team-panel/actions";
import { Fact, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { ReviseInvoiceForm } from "@/modules/zinny-team-panel/components/revise-invoice-form";
import { LICENCE_SAC, STATE_NAME } from "@/modules/zinny-team-panel/lib/constants";
import { formatDate, formatDateTime, formatINR, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { getInvoice, invoiceHistory, type InvoiceEvent } from "@/modules/zinny-team-panel/services/billing";
import { describeChanges } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: "Invoice" };

const EVENT_LABEL: Record<string, string> = {
  "plat.invoice.create": "Issued",
  "plat.invoice.revise": "Revised",
  "plat.invoice.paid": "Marked paid",
  "plat.invoice.unpaid": "Marked unpaid",
};

/** What one history entry changed, in words. */
function eventLines(e: InvoiceEvent): string[] {
  if (e.action === "plat.invoice.revise") return describeChanges(e.data.before, e.data.after);
  if (e.action === "plat.invoice.create" && typeof e.data.totalPaise === "number") return [`Total ${formatINR(e.data.totalPaise)}`];
  if (e.action === "plat.invoice.paid") return [`Paid on ${formatDate(String(e.data.paidOn ?? ""))}, reference ${String(e.data.reference ?? "")}`];
  if (e.action === "plat.invoice.unpaid") return [`Reason: ${String(e.data.reason ?? "")}`];
  return [];
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.finance")) return <NoAccess section="Zinny invoices" />;
  const { id } = await params;
  const i = await getInvoice(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const history = await invoiceHistory(actor, i.id);
  const gst = i.cgstPaise + i.sgstPaise + i.igstPaise;
  const rate = i.gstRateBp / 100;
  const revisions = history.filter((e) => e.action === "plat.invoice.revise").length;

  return (
    <>
      <PageHeader
        title={`Invoice ${i.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {i.status === "paid" ? <Badge tone="brand">Paid on {formatDate(i.paidOn)}</Badge> : i.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="gold">Unpaid</Badge>}
            {revisions > 0 && <Badge>Revised {revisions === 1 ? "once" : `${revisions} times`}</Badge>}
            <span>
              {i.universityName} · due {formatDate(i.dueDate)}
            </span>
          </span>
        }
        actions={
          i.licenceId && canPlatform(actor, "platform.licences") ? (
            <Link href={`/platform/licences/${i.universityId}`} className="inline-flex h-10 items-center whitespace-nowrap rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
              Its licence
            </Link>
          ) : undefined
        }
      />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="text-[14px]">
                <div className="text-[12.5px] text-muted">From</div>
                <div className="font-medium">{i.sellerName}</div>
                <div className="text-muted">GSTIN {i.sellerGstin ?? "not set"}</div>
                <div className="text-muted">{STATE_NAME[i.sellerStateCode] ?? i.sellerStateCode}</div>
              </div>
              <div className="text-[14px]">
                <div className="text-[12.5px] text-muted">To</div>
                <div className="font-medium">{i.buyerName}</div>
                <div className="text-muted">GSTIN {i.buyerGstin ?? "not registered"}</div>
                <div className="text-muted">{i.buyerAddress ?? STATE_NAME[i.buyerStateCode] ?? i.buyerStateCode}</div>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
              <Fact label="Invoice date">{formatDate(i.issueDate)}</Fact>
              <Fact label="Due">{formatDate(i.dueDate)}</Fact>
              <Fact label="Period">
                {formatDate(i.periodStart)} to {formatDate(i.periodEnd)}
              </Fact>
              <Fact label="SAC">{LICENCE_SAC}</Fact>
            </dl>
            <table className="mt-6 w-full text-[14px]">
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="py-2">
                    {i.description}
                    <div className="text-[12.5px] text-muted">List price</div>
                  </td>
                  <td className="tabular py-2 text-right align-top">{formatINR(i.listPricePaise)}</td>
                </tr>
                {i.discountPaise > 0 && (
                  <tr>
                    <td className="py-2 text-muted">
                      Discount
                      {i.discountNote && <div className="text-[12.5px]">{i.discountNote}</div>}
                    </td>
                    <td className="tabular py-2 text-right align-top">− {formatINR(i.discountPaise)}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-2">Net before GST</td>
                  <td className="tabular py-2 text-right">{formatINR(i.basePaise)}</td>
                </tr>
                {i.igstPaise > 0 ? (
                  <tr>
                    <td className="py-2 text-muted">IGST {rate}%</td>
                    <td className="tabular py-2 text-right">{formatINR(i.igstPaise)}</td>
                  </tr>
                ) : (
                  gst > 0 && (
                    <>
                      <tr>
                        <td className="py-2 text-muted">CGST {rate / 2}%</td>
                        <td className="tabular py-2 text-right">{formatINR(i.cgstPaise)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 text-muted">SGST {rate / 2}%</td>
                        <td className="tabular py-2 text-right">{formatINR(i.sgstPaise)}</td>
                      </tr>
                    </>
                  )
                )}
                <tr className="font-semibold">
                  <td className="py-2">Total</td>
                  <td className="tabular py-2 text-right">{formatINR(i.totalPaise)}</td>
                </tr>
              </tbody>
            </table>
            {i.createdByName && <p className="mt-4 text-[12.5px] text-muted">Issued by {i.createdByName}.</p>}
          </Card>

          <Card>
            <CardTitle hint="From the activity log">History</CardTitle>
            {history.length === 0 ? (
              <p className="text-[14px] text-muted">Nothing logged for this invoice.</p>
            ) : (
              <ol className="space-y-3 text-[14px]">
                {history.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.action === "plat.invoice.revise" ? "bg-gold" : "bg-brand"}`} aria-hidden />
                    <div className="min-w-0">
                      <div>
                        <span className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</span>
                        <span className="text-muted">
                          {" "}
                          by {e.byName ?? "Zinny system"} · {formatDateTime(e.at)}
                        </span>
                      </div>
                      {eventLines(e).map((line) => (
                        <div key={line} className="break-words text-[13px] text-muted">
                          {line}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="h-fit">
            {i.status === "unpaid" ? (
              <>
                <CardTitle>Record the payment</CardTitle>
                <ActionForm action={markPaidAction} className="space-y-3">
                  <input type="hidden" name="invoiceId" value={i.id} />
                  <Field label="Money arrived on">
                    <Input name="paidOn" type="date" defaultValue={todayIST()} max={todayIST()} required />
                  </Field>
                  <Field label="Payment reference" hint="UTR, cheque or transaction number">
                    <Input name="reference" required minLength={3} maxLength={120} />
                  </Field>
                  <SubmitButton>Mark paid</SubmitButton>
                </ActionForm>
              </>
            ) : (
              <>
                <CardTitle>Payment</CardTitle>
                <p className="text-[14px]">
                  Paid on {formatDate(i.paidOn)}, reference <span className="font-mono">{i.paymentReference}</span>.
                </p>
                <ActionForm action={markUnpaidAction} className="mt-4 space-y-3 border-t border-line pt-4" confirm="Mark this invoice unpaid again?">
                  <input type="hidden" name="invoiceId" value={i.id} />
                  <Field label="Recorded by mistake? Say why" hint="Logged with your name">
                    <Input name="reason" required minLength={5} maxLength={300} />
                  </Field>
                  <SubmitButton variant="danger">Mark unpaid</SubmitButton>
                </ActionForm>
              </>
            )}
          </Card>

          <Card className="h-fit">
            <CardTitle hint={i.status === "unpaid" ? "The number stays the same" : undefined}>Revise this invoice</CardTitle>
            {i.status === "unpaid" ? (
              <ReviseInvoiceForm
                invoice={{
                  id: i.id,
                  number: i.number,
                  description: i.description,
                  periodStart: i.periodStart,
                  periodEnd: i.periodEnd,
                  listPricePaise: i.listPricePaise,
                  discountPaise: i.discountPaise,
                  discountNote: i.discountNote,
                  gstRateBp: i.gstRateBp,
                  issueDate: i.issueDate,
                  dueDate: i.dueDate,
                  intraState: i.buyerStateCode === i.sellerStateCode,
                }}
              />
            ) : (
              <p className="text-[14px] text-muted">A paid invoice is locked. If the amount or dates are wrong, mark it unpaid first, revise it, then record the payment again.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
