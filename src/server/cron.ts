/** Cron routes are called by a scheduler with `Authorization: Bearer $CRON_SECRET`. */
import { timingSafeEqual } from "node:crypto";

export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const unauthorized = () => new Response("unauthorized", { status: 401 });
