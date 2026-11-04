import { Card, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { InvoiceForm } from "@/modules/zinny-team-panel/components/invoice-form";
import { invoiceDraft, invoiceTermsByUniversity } from "@/modules/zinny-team-panel/services/billing";
import { universityOptions } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ university?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.finance")) return <NoAccess section="Zinny invoices" />;
  const { university } = await searchParams;
  const [unis, terms, d] = await Promise.all([universityOptions(actor), invoiceTermsByUniversity(actor), invoiceDraft(actor, university)]);

  return (
    <>
      <PageHeader
        title="New invoice"
        subtitle="Picking the institute fills in its licence term. GST is split into CGST and SGST in Zinny's own state, IGST elsewhere. The number is given when you issue it."
      />
      <Card className="max-w-2xl">
        <InvoiceForm institutes={unis.map((u) => ({ id: u.id, name: u.name }))} terms={terms} initial={d} />
      </Card>
    </>
  );
}
