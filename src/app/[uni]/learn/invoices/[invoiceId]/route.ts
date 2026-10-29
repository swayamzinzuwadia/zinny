import { invoicePdfResponse } from "@/modules/payments/download";

/** The learner's own GST invoice as a PDF download (self.view_invoices). */
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ uni: string; invoiceId: string }> }) {
  const { uni, invoiceId } = await params;
  return invoicePdfResponse(uni, invoiceId, { inline: false });
}
