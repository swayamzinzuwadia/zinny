import { NextResponse } from "next/server";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { documentLink } from "@/modules/onboarding/services/documents";

export const dynamic = "force-dynamic";

/** Opens one of the institute's documents through a short-lived storage link. */
export async function GET(_: Request, { params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  try {
    return NextResponse.redirect(new URL(await documentLink(actor, id), _.url), 303);
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: 404 });
    throw e;
  }
}
