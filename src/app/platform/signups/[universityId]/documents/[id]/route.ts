import { NextResponse } from "next/server";
import { platformContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { reviewDocumentLink } from "@/modules/onboarding/services/review";

export const dynamic = "force-dynamic";

/** Opens a self-signed institute's document for the reviewer (platform.manage_universities). */
export async function GET(req: Request, { params }: { params: Promise<{ universityId: string; id: string }> }) {
  const { universityId, id } = await params;
  const actor = await platformContext();
  try {
    return NextResponse.redirect(new URL(await reviewDocumentLink(actor, universityId, id), req.url), 303);
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
}
