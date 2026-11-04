/**
 * Demo requests: the "Book a demo" form on the public website. Nobody is signed in, so the
 * request is checked here, recorded in the Zinny team's activity log (no table of its own),
 * and emailed to every active Super Admin, who replies to the sender directly.
 */
import { createHash } from "node:crypto";
import { and, count, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { auditLog, roleAssignments, users } from "@/db/schema";
import { appUrl } from "@/server/auth/config";
import type { Actor } from "@/server/authz/engine";
import { sendEmail } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { db, EMAIL_RE, logAction } from "./shared";

export const DEMO_REQUEST_ACTION = "plat.demo_request";

/** From one network, at most this many requests an hour; from everyone, at most this many. */
export const DEMO_REQUEST_LIMITS = { perSender: 3, overall: 30, windowMinutes: 60 };

export type DemoRequestInput = {
  name?: string;
  institute?: string;
  role?: string;
  phone?: string;
  email?: string;
  city?: string;
  message?: string;
  /** The spam trap: hidden from people, filled in by bots. */
  website?: string;
};

export type DemoRequest = { name: string; institute: string; role: string; phone: string; email: string; city: string; message: string };

/** The website has nobody signed in, so the log entry is the system's. */
const WEBSITE: Actor = { userId: "", name: "Zinny website", email: "website@zinny", universityId: null, assignments: [], supportSessionId: null };

const oneLine = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

function required(v: string | undefined, label: string, max: number) {
  const s = oneLine(v);
  if (s.length < 2) throw new ValidationError(`Enter ${label}.`);
  if (s.length > max) throw new ValidationError(`Keep ${label} under ${max} characters.`);
  return s;
}

function optional(v: string | undefined, label: string, max: number) {
  const s = oneLine(v);
  if (s.length > max) throw new ValidationError(`Keep ${label} under ${max} characters.`);
  return s;
}

/** Checks and tidies a request. Throws a ValidationError that says what to fix. */
export function cleanDemoRequest(input: DemoRequestInput): DemoRequest {
  const name = required(input.name, "your name", 80);
  const institute = required(input.institute, "your institute's name", 120);
  const role = optional(input.role, "your role", 80);
  const email = oneLine(input.email).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new ValidationError("Enter an email address we can reply to, like name@institute.in.");
  const phone = oneLine(input.phone);
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[\d\s()-]+$/.test(phone) || digits.length < 10 || digits.length > 15) {
    throw new ValidationError("Enter a phone number with at least 10 digits, like 98200 12345.");
  }
  const city = optional(input.city, "your city", 80);
  const message = (input.message ?? "").trim();
  if (message.length > 2000) throw new ValidationError("Keep your message under 2,000 characters.");
  return { name, institute, role, phone, email, city, message };
}

/** Active Super Admins of the Zinny team: platform role, not revoked, started and not ended. */
export async function superAdminEmails(now = new Date()): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ email: users.email })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(
      and(
        eq(roleAssignments.scopeType, "platform"),
        eq(roleAssignments.role, "super_admin"),
        isNull(roleAssignments.revokedAt),
        lte(roleAssignments.startsAt, now),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    );
  return rows.map((r) => r.email).sort();
}

const fingerprint = (ip: string | null | undefined) =>
  createHash("sha256")
    .update(`zinny-demo:${ip ?? "unknown"}`)
    .digest("base64url")
    .slice(0, 24);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The email to the Zinny team: plain text first, with a simple HTML version. */
export function demoRequestEmail(r: DemoRequest, logUrl: string | null) {
  const rows: [string, string][] = [
    ["Name", r.name],
    ["Institute", r.institute],
    ...(r.role ? ([["Role", r.role]] as [string, string][]) : []),
    ["Phone", r.phone],
    ["Email", r.email],
    ...(r.city ? ([["City", r.city]] as [string, string][]) : []),
  ];
  const subject = `Demo request from ${r.institute}`;
  const text = [
    `${r.name} from ${r.institute} asked for a Zinny demo on the website.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(r.message ? ["", "Message:", r.message] : []),
    "",
    "Reply to this email to answer them directly.",
    ...(logUrl ? ["", `It is also in the activity log: ${logUrl}`] : []),
  ].join("\n");
  const cell = "padding:6px 0;font-size:15px;line-height:1.5;color:#14261f;vertical-align:top";
  const html = `<!doctype html><html><body style="margin:0;background:#faf6ea;font-family:Lexend,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ea;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf7;border:1px solid #e8e0cc;border-radius:22px;padding:32px"><tr><td>
<p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#0b5e4c">zinny</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14261f">${esc(subject)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#14261f">${esc(r.name)} from ${esc(r.institute)} asked for a Zinny demo on the website.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows
    .map(([k, v]) => `<tr><td style="${cell};padding-right:16px;color:#5d6b64">${esc(k)}</td><td style="${cell}">${esc(v)}</td></tr>`)
    .join("")}</table>
${r.message ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#14261f;white-space:pre-line">${esc(r.message)}</p>` : ""}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#98a39d">Reply to this email to answer them directly.${logUrl ? ` It is also in the <a href="${esc(logUrl)}" style="color:#0b5e4c">activity log</a>.` : ""}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/**
 * A demo request from the website. Bots that fill in the hidden field get a normal-looking
 * answer and nothing happens. Too many requests from one network in an hour are refused.
 */
export async function requestDemo(input: DemoRequestInput, meta: { ip?: string | null; now?: Date } = {}): Promise<{ status: "sent" | "ignored"; recipients: number }> {
  if ((input.website ?? "").trim() !== "") return { status: "ignored", recipients: 0 };
  const request = cleanDemoRequest(input);
  const now = meta.now ?? new Date();
  const from = fingerprint(meta.ip);

  await db().transaction(async (tx) => {
    // One request at a time, so parallel ones can't slip past the count.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DEMO_REQUEST_ACTION}))`);
    const since = new Date(now.getTime() - DEMO_REQUEST_LIMITS.windowMinutes * 60_000);
    const [{ sender, overall }] = await tx
      .select({
        sender: sql<number>`count(*) filter (where ${auditLog.data}->>'from' = ${from})`.mapWith(Number),
        overall: count(),
      })
      .from(auditLog)
      .where(and(eq(auditLog.action, DEMO_REQUEST_ACTION), gte(auditLog.at, since)));
    if (sender >= DEMO_REQUEST_LIMITS.perSender || overall >= DEMO_REQUEST_LIMITS.overall) {
      throw new ValidationError("We've had several requests from your network in the last hour. Try again in an hour.", "rate_limited");
    }
    await logAction(tx, WEBSITE, { universityId: null }, DEMO_REQUEST_ACTION, "demo_request", null, { ...request, from });
  });

  const to = await superAdminEmails(now);
  if (to.length === 0) {
    console.error("[demo request] No active Super Admin to email; the request is only in the activity log.");
    return { status: "sent", recipients: 0 };
  }
  let logUrl: string | null = null;
  try {
    logUrl = `${appUrl()}/platform/support/log?scope=all&action=${DEMO_REQUEST_ACTION}`;
  } catch {
    logUrl = null;
  }
  try {
    await sendEmail({ to, replyTo: request.email, kind: "zinny.demo_request", universityId: null, ...demoRequestEmail(request, logUrl) });
  } catch (e) {
    // It is already in the activity log; the sender shouldn't have to try again.
    console.error("[demo request] Email to the Zinny team failed", e);
  }
  return { status: "sent", recipients: to.length };
}
