import { unstable_rethrow } from "next/navigation";
import { platformContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { renderInvoicePdf } from "@/modules/payments/pdf/invoice-pdf";
import { LICENCE_SAC, zinnySeller } from "@/modules/zinny-team-panel/lib/constants";
import { getInvoice } from "@/modules/zinny-team-panel/services/billing";

/**
 * A Zinny invoice as an A4 PDF (platform.finance, checked by getInvoice). Drawn with the
 * shared GST invoice layout; nothing is stored, so it always matches the invoice as it is
 * now, revisions and payment included.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await platformContext();
    const { id } = await params;
    const i = await getInvoice(actor, id);
    const seller = zinnySeller();
    const gst = i.cgstPaise + i.sgstPaise + i.igstPaise;
    const bytes = await renderInvoicePdf({
      seller: { legalName: i.sellerName, tradeName: "Zinny", address: seller.address, gstin: i.sellerGstin, stateCode: i.sellerStateCode },
      invoice: { number: i.number, date: i.issueDate, placeOfSupply: i.buyerStateCode, dueDate: i.dueDate, category: "Zinny licence" },
      buyer: { name: i.buyerName, email: null, address: i.buyerAddress, gstin: i.buyerGstin },
      gst: gst > 0 || i.gstRateBp > 0,
      line: { course: i.description, batch: "", sac: LICENCE_SAC, basePaise: i.basePaise },
      items: [{ description: i.description, quantity: 1, unitPricePaise: i.listPricePaise, amountPaise: i.listPricePaise }],
      ...(i.discountPaise > 0 && { discount: { paise: i.discountPaise, note: i.discountNote ?? "Discount" } }),
      tax: { cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, ratePercent: i.gstRateBp / 100 },
      totalPaise: i.totalPaise,
      payment: { paidOn: i.paidOn, reference: i.paymentReference, orderRef: i.number },
      manual: { status: i.status === "paid" ? "paid" : "unpaid", overdue: i.overdue, paidOn: i.paidOn, mode: null, reference: i.paymentReference, cancelReason: null },
      footer: `${i.sellerName}. Software licence, SAC ${LICENCE_SAC}.`,
    });
    const name = `Zinny-invoice-${i.number.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
    const inline = new URL(req.url).searchParams.get("download") !== "1";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) {
      const text = e.status === 404 ? "This invoice wasn't found. Go back to Invoices and open it from the list." : e.message;
      return new Response(text, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    console.error("[billing] invoice PDF failed:", e);
    return new Response("The PDF couldn't be prepared. Try again in a minute.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
