import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { markPaidAction, markUnpaidAction } from "@/modules/zinny-team-panel/actions";
import { BackLink, Fact, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { LICENCE_SAC, STATE_NAME } from "@/modules/zinny-team-panel/lib/constants";
import { formatDate, formatINR, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { getInvoice } from "@/modules/zinny-team-panel/services/billing";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.finance")) return <NoAccess section="Zinny billing" who="Super Admins and Finance Admins" />;
  const { id } = await params;
  const i = await getInvoice(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const gst = i.cgstPaise + i.sgstPaise + i.igstPaise;
  const rate = i.gstRateBp / 100;

  return (
    <>
      <BackLink href="/platform/billing">Zinny invoices</BackLink>
      <PageHeader
        title={`Invoice ${i.number}`}
        subtitle={
          <span className="flex items-center gap-2">
            {i.status === "paid" ? <Badge tone="brand">Paid on {formatDate(i.paidOn)}</Badge> : i.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="gold">Unpaid</Badge>}
            <span>
              {i.universityName} · due {formatDate(i.dueDate)}
            </span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
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
            <Fact label="Issued">{formatDate(i.issueDate)}</Fact>
            <Fact label="Due">{formatDate(i.dueDate)}</Fact>
            <Fact label="Period">
              {formatDate(i.periodStart)} to {formatDate(i.periodEnd)}
            </Fact>
            <Fact label="SAC">{LICENCE_SAC}</Fact>
          </dl>
          <table className="mt-6 w-full text-[14px]">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2">{i.description}</td>
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
      </div>
    </>
  );
}
