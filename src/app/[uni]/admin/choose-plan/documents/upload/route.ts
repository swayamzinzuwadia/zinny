import { NextResponse } from "next/server";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { PART_BYTES } from "@/modules/onboarding/lib/constants";
import { finishDocumentUpload, putDocumentPart, startDocumentUpload } from "@/modules/onboarding/services/documents";

export const dynamic = "force-dynamic";

const fail = (e: unknown) => {
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong on our side, so the file wasn't saved. Please try again." }, { status: 500 });
};

/**
 * Institute documents, sent in parts by the browser (components/upload-client.ts):
 *   ?op=start   JSON { kind, fileName, size, contentType } → { documentId, parts, partBytes }
 *   ?op=part&id=…&index=…   the raw bytes of one part
 *   ?op=finish&id=…   → { documentId }
 * Under choose-plan so a frozen institute's admins can still send documents.
 */
export async function POST(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const url = new URL(req.url);
  try {
    switch (url.searchParams.get("op")) {
      case "start": {
        const body = (await req.json().catch(() => ({}))) as { kind?: string; fileName?: string; size?: number; contentType?: string };
        const started = await startDocumentUpload(actor, { kind: String(body.kind ?? ""), fileName: String(body.fileName ?? ""), size: Number(body.size ?? 0), contentType: String(body.contentType ?? "") });
        return NextResponse.json(started);
      }
      case "part": {
        const len = Number(req.headers.get("content-length") ?? "0");
        if (len > PART_BYTES) return NextResponse.json({ error: "That part of the file is too big. Try uploading it again." }, { status: 413 });
        const body = new Uint8Array(await req.arrayBuffer());
        await putDocumentPart(actor, url.searchParams.get("id") ?? "", Number(url.searchParams.get("index")), body);
        return NextResponse.json({ ok: true });
      }
      case "finish": {
        const doc = await finishDocumentUpload(actor, url.searchParams.get("id") ?? "");
        return NextResponse.json({ documentId: doc.id });
      }
      default:
        return NextResponse.json({ error: "Unknown upload step." }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
