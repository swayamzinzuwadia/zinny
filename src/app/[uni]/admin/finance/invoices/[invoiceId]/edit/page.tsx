import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { InvoiceForm } from "@/modules/payments/components/invoice-form";
import { getManualInvoice, invoiceFormContext } from "@/modules/payments/manual-invoices";

export const metadata = { title: "Edit invoice" };
export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ uni: string; invoiceId: string }> }) {
  const { uni, invoiceId } = await params;
  const { actor, university } = await spaceContext(uni);
  const back = `/${uni}/admin/finance/invoices/${invoiceId}`;
  if (!can(actor, "finance.manage", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Edit invoice" />
        <Empty title="You can't change invoices">Only Accounts &amp; Fees and Institute Admins change invoices.</Empty>
      </>
    );
  }
  const d = await getManualInvoice(actor, invoiceId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!d) notFound();
  const i = d.invoice;
  if (i.status !== "unpaid") {
    return (
      <>
        <PageHeader title={`Invoice ${i.number}`} />
        <Empty title={i.status === "paid" ? "This invoice is paid, so it's locked" : "A cancelled invoice can't be changed"}>
          {i.status === "paid" ? "Mark it unpaid first if it needs changing." : "Create a new invoice instead."}{" "}
          <Link href={back} className="font-medium text-brand hover:underline">
            Back to the invoice
          </Link>
        </Empty>
      </>
    );
  }
  const c = await invoiceFormContext(actor);
  return (
    <>
      <PageHeader title={`Edit invoice ${i.number}`} subtitle="Change the lines, discount, dates and notes while the invoice is unpaid. Every change is recorded in its history." />
      <InvoiceForm
        uni={uni}
        {...c}
        sellerState={i.sellerStateCode}
        edit={{
          invoiceId: i.id,
          number: i.number,
          category: d.category.name,
          buyerName: i.buyerName,
          buyerEmail: i.buyerEmail,
          placeOfSupply: i.placeOfSupply,
          gstApplied: i.gstApplied,
          gstRateBp: i.gstRateBp,
          lines: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPricePaise: l.unitPricePaise })),
          discountPaise: i.discountPaise,
          discountNote: i.discountNote,
          issueDate: i.issueDate,
          dueDate: i.dueDate,
          notes: i.notes,
        }}
      />
    </>
  );
}
