import { invoicePdfResponse } from "@/modules/payments/download";

/** Any invoice of the institute as a PDF, order or raised here, for staff with finance.view. Opens in the browser. */
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ uni: string; invoiceId: string }> }) {
  const { uni, invoiceId } = await params;
  return invoicePdfResponse(uni, invoiceId, { inline: true });
}
