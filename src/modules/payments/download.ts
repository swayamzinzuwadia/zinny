/**
 * Shared by the two invoice download routes (learner and Sales): turns the service
 * result into a PDF response, and known errors into plain responses.
 */
import { unstable_rethrow } from "next/navigation";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { invoiceDownload } from "./invoices";

export async function invoicePdfResponse(uni: string, invoiceId: string, opts: { inline: boolean }): Promise<Response> {
  try {
    const { actor } = await spaceContext(uni);
    const { fileName, bytes } = await invoiceDownload(actor, invoiceId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
        "content-disposition": `${opts.inline ? "inline" : "attachment"}; filename="${fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) {
      const text = e.status === 404 ? "This invoice wasn't found, or it isn't yours. Go back and open it from your invoices." : e.message;
      return new Response(text, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    console.error("[payments] invoice download failed:", e);
    return new Response("The invoice couldn't be prepared. Try again in a minute.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
