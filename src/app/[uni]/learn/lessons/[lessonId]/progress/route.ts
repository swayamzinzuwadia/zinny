import { videoProgressResponse } from "@/modules/content-progress/http";
import { spaceContext } from "@/server/context";

/** The video player reports the parts it has played; the lesson completes at 90% watched. */
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ uni: string; lessonId: string }> }) {
  const { uni, lessonId } = await params;
  const { actor } = await spaceContext(uni);
  return videoProgressResponse(actor, lessonId, req);
}
