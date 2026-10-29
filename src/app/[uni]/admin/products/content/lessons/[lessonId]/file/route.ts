import { staffFileResponse } from "@/modules/content-progress/http";
import { spaceContext } from "@/server/context";

/** Staff preview of a lesson's uploaded file: redirects to a short-lived signed URL (needs course.view). */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ uni: string; lessonId: string }> }) {
  const { uni, lessonId } = await params;
  const { actor } = await spaceContext(uni);
  return staffFileResponse(actor, lessonId, req);
}
