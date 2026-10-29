import { isCronRequest, unauthorized } from "@/server/cron";
import { drainEvents } from "@/server/events-drain";

/**
 * Safety net for event delivery (contracts.md section 2). Events are normally delivered
 * right after the request that emitted them; schedule this every minute with
 * `Authorization: Bearer $CRON_SECRET` to retry failures and catch anything missed.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronRequest(req)) return unauthorized();
  const result = await drainEvents();
  return Response.json({ ok: true, ...result });
}
