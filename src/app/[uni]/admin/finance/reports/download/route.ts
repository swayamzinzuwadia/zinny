import { NextResponse, type NextRequest } from "next/server";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { parseQuery, toSearchParams } from "@/modules/reports-board/lib/query";
import { exportReport } from "@/modules/reports-board/service";

export const dynamic = "force-dynamic";

/**
 * GET /[uni]/admin/finance/reports/download?report=…&range=…&format=csv|xlsx
 * Runs the report with the same checks as the page and sends it as a file. Anything that
 * goes wrong sends the person back to the page, which shows what to fix.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const query = parseQuery(sp);
  const back = new URL(`/${uni}/admin/finance/reports?${toSearchParams({ ...query, page: 1 }).toString()}`, req.nextUrl.origin);
  const format = sp.format === "csv" || sp.format === "xlsx" ? sp.format : null;
  if (!format || !query.reportId) return NextResponse.redirect(back, 303);

  try {
    const file = await exportReport(actor, query, format);
    const body = typeof file.body === "string" ? file.body : new Blob([new Uint8Array(file.body)]);
    return new NextResponse(body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    // A known problem (no access, a bad filter or date) shows on the page when it runs the same choice.
    if (!(e instanceof AppError)) {
      console.error("Report download failed", e);
      back.searchParams.set("failed", "1");
    }
    return NextResponse.redirect(back, 303);
  }
}
