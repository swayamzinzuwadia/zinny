import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { activityLogCsv, parseLogFilters } from "@/modules/zinny-team-panel/services/support";
import { todayIST } from "@/modules/zinny-team-panel/lib/format";

export const dynamic = "force-dynamic";

/** GET /platform/support/log/export?scope=&university=&person=&action=&from=&to= → the filtered activity log as CSV. */
export async function GET(req: Request) {
  // Sends people who aren't signed in to the sign-in page.
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.support_mode")) {
    return new Response("You don't have access to the activity log. Ask a Super Admin for the Support Agent role.", { status: 403 });
  }
  const q = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { filters } = parseLogFilters(q);
  const { csv, truncated } = await activityLogCsv(actor, filters);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zinny-activity-log-${todayIST()}.csv"`,
      "Cache-Control": "no-store",
      ...(truncated && { "X-Zinny-Truncated": "true" }),
    },
  });
}
