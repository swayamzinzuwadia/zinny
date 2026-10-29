import { finishUploadResponse, uploadPartResponse } from "@/modules/content-progress/http";
import { spaceContext } from "@/server/context";

/** PUT ?part=n sends one part of the file (at most 4 MB); POST joins the parts into the lesson's file. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ uni: string; uploadId: string }> };

export async function PUT(req: Request, { params }: Params) {
  const { uni, uploadId } = await params;
  const { actor } = await spaceContext(uni);
  return uploadPartResponse(actor, uploadId, req);
}

export async function POST(req: Request, { params }: Params) {
  const { uni, uploadId } = await params;
  const { actor } = await spaceContext(uni);
  return finishUploadResponse(actor, uploadId, req);
}
