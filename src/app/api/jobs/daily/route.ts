import { systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import { systemActorFor } from "@/server/actor";
import { facultyExpiryAlerts } from "@/server/services/batches";
import { expireStaleHolds } from "@/server/services/enrolment";
import { withTenant } from "@/server/tenant";

/** Daily job (e.g. Vercel Cron): release lapsed seat holds and warn HODs about expiring visiting faculty. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const unis = await systemDb().select({ id: universities.id }).from(universities);
  const report = [];
  for (const u of unis) {
    const actor = systemActorFor(u.id);
    const released = await withTenant(actor, (tx) => expireStaleHolds(tx));
    const alerts = await facultyExpiryAlerts(actor, 14);
    report.push({ university: u.id, released, alerts: alerts.length });
  }
  return Response.json({ ok: true, report });
}
