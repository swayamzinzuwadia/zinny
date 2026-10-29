import { NextResponse } from "next/server";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { certificateDownloadUrl } from "@/modules/certificates/service";

export const dynamic = "force-dynamic";

/** A learner's download of their own certificate: redirects to a short-lived link to the stored PDF. */
export async function GET(req: Request, { params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  try {
    return NextResponse.redirect(new URL(await certificateDownloadUrl(actor, id), req.url), 303);
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
