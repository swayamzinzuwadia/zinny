import { NextResponse } from "next/server";
import { currentUserId } from "@/server/auth/session";
import { loadActor } from "@/server/actor";
import { ForbiddenError } from "@/server/errors";
import { searchUniversities } from "@/modules/zinny-team-panel/services/universities";

/** Live institute search for the dropdown: GET /platform/institutes/search?q=lake */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to search institutes." }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const actor = await loadActor(userId, null);
    const hits = await searchUniversities(actor, q, 8);
    return NextResponse.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Your role doesn't include institutes." }, { status: 403 });
    throw e;
  }
}
