import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { templateSamplePdf } from "@/modules/certificates/service";

export const dynamic = "force-dynamic";

/** A sample PDF of a template filled with sample data, to check printing before issuing. */
export async function GET(_req: Request, { params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  try {
    const { pdf, name } = await templateSamplePdf(actor, id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9 ._-]/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
