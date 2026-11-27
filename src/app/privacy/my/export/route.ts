import { currentUserId } from "@/server/auth/session";
import { loadActor } from "@/server/core";
import { exportMyData } from "@/modules/privacy/services/erasure";

/** "Download my data" for Zinny's own records: a JSON file of the signed-in person's data across the marketplace. */
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.redirect(new URL("/login?next=/privacy/my", request.url), 303);
  const data = await exportMyData(await loadActor(userId, null));
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="zinny-my-data-${data.generatedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
