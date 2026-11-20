import { NextResponse } from "next/server";
import { currentUserId } from "@/server/auth/session";
import { loadActor } from "@/server/actor";
import { ForbiddenError } from "@/server/errors";
import { globalSearch } from "@/modules/zinny-team-panel/services/search";

/** Global search for the top bar: GET /platform/search?q=gst */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to search." }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const actor = await loadActor(userId, null);
    const groups = await globalSearch(actor, q);
    return NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Your role doesn't include the Zinny team panel." }, { status: 403 });
    throw e;
  }
}
