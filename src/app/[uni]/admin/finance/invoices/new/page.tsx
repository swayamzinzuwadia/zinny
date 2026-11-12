import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { InvoiceForm } from "@/modules/payments/components/invoice-form";
import { invoiceFormContext } from "@/modules/payments/manual-invoices";

export const metadata = { title: "Create invoice" };
export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "finance.manage", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Create invoice" />
        <Empty title="You can't create invoices">
          Only Accounts &amp; Fees and Institute Admins raise invoices.{" "}
          <Link href={`/${uni}/admin/finance/invoices`} className="font-medium text-brand hover:underline">
            Back to invoices
          </Link>
        </Empty>
      </>
    );
  }
  const c = await invoiceFormContext(actor);
  return (
    <>
      <PageHeader title="Create invoice" subtitle="Bill a student or anyone else for something outside checkout. It gets the next number in the same series as your order invoices." />
      <InvoiceForm uni={uni} {...c} />
    </>
  );
}
