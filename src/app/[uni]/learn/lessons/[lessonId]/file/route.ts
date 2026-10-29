import { learnerFileResponse } from "@/modules/content-progress/http";
import { spaceContext } from "@/server/context";

/**
 * A lesson's uploaded video or PDF: redirects to a short-lived signed URL. Refused unless
 * the learner is enrolled (active or completed) and the lesson is open to them.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ uni: string; lessonId: string }> }) {
  const { uni, lessonId } = await params;
  const { actor } = await spaceContext(uni);
  return learnerFileResponse(actor, lessonId, req);
}
