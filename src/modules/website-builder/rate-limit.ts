/**
 * Rate limits for the public forms (enquiries and reviews). Each submission is recorded in
 * site_submissions with an HMAC of the sender's IP (never the IP itself). A sender may send a
 * few per hour, and a whole site accepts a bounded number per hour, so a flood can't bury the
 * inbox. Rows older than a week are removed by the daily housekeeping job.
 */
import { createHmac } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { ConflictError } from "@/server/errors";
import { siteSubmissions } from "./schema";

export type SubmissionKind = "enquiry" | "review";

export const RATE_LIMITS: Record<SubmissionKind, { perSender: number; perSite: number; windowMinutes: number }> = {
  enquiry: { perSender: 5, perSite: 200, windowMinutes: 60 },
  review: { perSender: 3, perSite: 100, windowMinutes: 60 },
};

/** A stable, private identifier for the sender's network address. */
export function fingerprint(ip: string | null | undefined): string {
  const secret = process.env.SITE_FINGERPRINT_SECRET || process.env.CRON_SECRET || "zinny-site-fingerprint";
  return createHmac("sha256", secret)
    .update((ip ?? "").trim().toLowerCase() || "unknown")
    .digest("base64url")
    .slice(0, 32);
}

/** The client's IP from proxy headers (the first x-forwarded-for entry, else x-real-ip). */
export function clientIp(h: { get(name: string): string | null }): string | null {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || null;
  return h.get("x-real-ip")?.trim() || null;
}

/**
 * Records one submission, or refuses it when the sender or the site is over its limit.
 * Runs inside the submission's transaction, serialised per site and kind, so parallel
 * requests can't slip past the count.
 */
export async function takeSubmissionSlot(tx: Tx, universityId: string, kind: SubmissionKind, fp: string, now = new Date()) {
  const limit = RATE_LIMITS[kind];
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`site_submissions:${universityId}:${kind}`}))`);
  const since = new Date(now.getTime() - limit.windowMinutes * 60_000);
  const [{ sender, site }] = await tx
    .select({
      sender: sql<number>`count(*) filter (where ${siteSubmissions.fingerprint} = ${fp})::int`,
      site: sql<number>`count(*)::int`,
    })
    .from(siteSubmissions)
    .where(and(eq(siteSubmissions.universityId, universityId), eq(siteSubmissions.kind, kind), gt(siteSubmissions.createdAt, since)));
  const what = kind === "enquiry" ? "enquiries" : "reviews";
  if (sender >= limit.perSender) {
    throw new ConflictError(`You have sent several ${what} in the last hour. Please wait an hour and try again, or call us.`, "rate_limited");
  }
  if (site >= limit.perSite) {
    throw new ConflictError(`We are receiving a lot of ${what} right now. Please try again in an hour, or call us.`, "rate_limited");
  }
  await tx.insert(siteSubmissions).values({ universityId, kind, fingerprint: fp, createdAt: now });
}
