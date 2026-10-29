/** Runs registered jobs once per university, as that university's system actor, under row-level security. */
import { asc } from "drizzle-orm";
import type { Job } from "@/contracts/module";
import { systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import { systemActorFor } from "./actor";
import { CORE_JOBS } from "./jobs";
import { jobs } from "./registry";

export type JobRunReport = { jobId: string; universityId: string; ok: boolean; error?: string; ms: number }[];

export async function runJobs(every: Job["every"], opts: { universityId?: string } = {}): Promise<JobRunReport> {
  const list = [...CORE_JOBS.filter((j) => j.every === every), ...jobs(every)];
  const unis = opts.universityId
    ? [{ id: opts.universityId }]
    : await systemDb().select({ id: universities.id }).from(universities).orderBy(asc(universities.createdAt));
  const report: JobRunReport = [];
  for (const u of unis) {
    for (const job of list) {
      const started = Date.now();
      try {
        await job.run(systemActorFor(u.id));
        report.push({ jobId: job.id, universityId: u.id, ok: true, ms: Date.now() - started });
      } catch (e) {
        // One failing job or university never stops the others.
        console.error(`[jobs] ${job.id} failed for ${u.id}:`, e);
        report.push({ jobId: job.id, universityId: u.id, ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
      }
    }
  }
  return report;
}
