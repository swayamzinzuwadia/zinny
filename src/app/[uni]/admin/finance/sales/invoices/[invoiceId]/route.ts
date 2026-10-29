import { invoicePdfResponse } from "@/modules/payments/download";

/** Any GST invoice of the university as a PDF, for staff with finance.view (Sales page). */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ uni: string; invoiceId: string }> }) {
  const { uni, invoiceId } = await params;
  return invoicePdfResponse(uni, invoiceId, { inline: new URL(req.url).searchParams.get("view") === "1" });
}
