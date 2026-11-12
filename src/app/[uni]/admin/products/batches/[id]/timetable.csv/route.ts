import { unstable_rethrow } from "next/navigation";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { readBatchTimetable } from "@/server/services/batch-plan";
import { timetableCsv } from "../timetable-rows";

/** The batch's full dated timetable as a CSV (batch.view), with the same filters as the Timetable tab. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  try {
    const { actor } = await spaceContext(uni);
    const q = new URL(req.url).searchParams;
    const { timetable, schedule } = await readBatchTimetable(actor, id);
    const csv = timetableCsv(timetable, { sectionId: q.get("section") || undefined, facultyUserId: q.get("faculty") || undefined });
    const name = `${schedule.courseTitle}-${schedule.batchName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="timetable-${name || "batch"}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return new Response(e.message, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    console.error("[batch-plan] timetable export failed:", e);
    return new Response("The download failed. Try again in a minute.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
