import { unstable_rethrow } from "next/navigation";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { invoiceRegisterCsv, parseRegisterFilters } from "@/modules/payments/invoice-register";

/** CSV of the invoices the filters match (finance.view). */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  try {
    const { actor } = await spaceContext(uni);
    const filters = parseRegisterFilters(Object.fromEntries(new URL(req.url).searchParams));
    const { csv } = await invoiceRegisterCsv(actor, filters);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="invoices-${uni}-${stamp}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return new Response(e.message, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    console.error("[payments] invoice export failed:", e);
    return new Response("The export failed. Try again in a minute.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
