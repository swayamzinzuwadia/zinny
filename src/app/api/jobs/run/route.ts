import { isCronRequest, unauthorized } from "@/server/cron";
import { runJobs } from "@/server/jobs-runner";

/**
 * Scheduled jobs (contracts.md section 5). Call with `Authorization: Bearer $CRON_SECRET`:
 *   GET /api/jobs/run?every=minute   every minute
 *   GET /api/jobs/run?every=hour     every hour
 *   GET /api/jobs/run?every=day      once a day (replaces /api/jobs/daily)
 * Runs each registered job once per university, as that university's system actor.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronRequest(req)) return unauthorized();
  const every = new URL(req.url).searchParams.get("every");
  if (every !== "minute" && every !== "hour" && every !== "day") {
    return Response.json({ error: "Pass ?every=minute, hour or day." }, { status: 400 });
  }
  const report = await runJobs(every);
  return Response.json({ ok: report.every((r) => r.ok), every, report });
}
