import { NextResponse, type NextRequest } from "next/server";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { registerHref } from "@/modules/live-classes/links";
import { startClass } from "@/modules/live-classes/staff";

export const dynamic = "force-dynamic";

/**
 * "Start class" (a POST form with target=_blank): records when the class started, then
 * sends that tab to the meeting. If it can't start (too early, ended, no link, no access),
 * the tab opens the register with the reason instead.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ uni: string; id: string; date: string }> }) {
  const { uni, id, date } = await params;
  // Same-origin only: the session cookie is SameSite=Lax, and this check keeps it that way.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return new NextResponse("Cross-site request refused.", { status: 403 });

  const { actor } = await spaceContext(uni);
  const form = await req.formData().catch(() => null);
  const startRaw = String(form?.get("start") ?? "");
  const start = /^\d{2}:\d{2}$/.test(startRaw) ? startRaw : null;
  const back = (code: string) => {
    const url = new URL(registerHref(uni, id, date, start), req.nextUrl.origin);
    url.searchParams.set("notice", code);
    return NextResponse.redirect(url, 303);
  };
  try {
    const { url } = await startClass(actor, { batchId: id, date, startTime: start });
    return NextResponse.redirect(url, 303);
  } catch (e) {
    if (e instanceof AppError) return back(e.code === "forbidden" ? "forbidden" : e.code === "not_found" ? "not_found" : e.code);
    throw e;
  }
}
