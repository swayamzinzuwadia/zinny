import { spaceContext } from "@/server/context";
import { exportMyData } from "@/modules/privacy/services/erasure";

/** "Download my data": a JSON file of what this institute holds about the signed-in person. */
export async function GET(_: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const data = await exportMyData(actor);
  const name = `zinny-${uni}-my-data-${data.generatedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
