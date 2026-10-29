import { startUploadResponse } from "@/modules/content-progress/http";
import { spaceContext } from "@/server/context";

/** Starts a lesson file upload (needs content.manage on the lesson's course). */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  return startUploadResponse(actor, req);
}
