/**
 * Delivery: from core notifications (and direct sendEmail/sendSms calls) to messages
 * that reach people.
 *
 * The job (every minute, per university, as its system actor):
 *   1. plan   – new core notifications are claimed once each (notif_dispatches primary key)
 *               and turned into one notif_deliveries row per channel the admin defaults and
 *               the person's preferences allow (unique per notification and channel).
 *   2. send   – due rows are claimed one at a time with a conditional update, so two runs
 *               that overlap can never both send a row; then the provider is called outside
 *               any transaction and the outcome recorded.
 *   3. retry  – retryable failures wait 1 min, 5 min, 30 min, then 2 h; after 5 attempts the
 *               row is marked failed. A send interrupted mid-way (a crash) is only repeated
 *               when the provider drops repeats itself (Resend's idempotency key); otherwise it
 *               is marked failed rather than risk the message arriving twice.
 *
 * Quiet hours: SMS and WhatsApp wait until 8 am (university time) between 9 pm and 8 am,
 * except security messages (sign-in codes, password resets).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { consoleMailTransport, type MailMessage } from "@/contracts/mail";
import { consoleSmsTransport, type SmsMessage } from "@/contracts/sms";
import type { UniversityLite } from "@/contracts/core";
import type { Tx } from "@/db/client";
import { notifications } from "@/db/schema";
import { assertCan, audit, systemActorFor, universityLite, withTenant, type Actor } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { absoluteUrl } from "./config";
import { CHANNELS, isCoreKind, isSecurityKind, kindDefinition } from "./kinds";
import { emailFooter, renderEmail, renderText, unsubscribeHeaders } from "./messages";
import { toE164 } from "./phone";
import { activeProviders, pace, ProviderError, safeToRepeat, type OutboundEmail, type OutboundText, type Providers } from "./providers";
import { decorateDirectEmail, oneLine } from "./render";
import { notifDeliveries, notifDispatches, notifSuppressions, type Channel, type DeliveryPayload } from "./schema";
import {
  channelAllowed,
  ensureUniversitySettings,
  isSuppressed,
  kindConfigs,
  personByEmail,
  preferenceMap,
  prefKey,
  readUniversitySettings,
  recipients,
  type KindConfig,
} from "./store";
import { isQuietHours, quietHoursEnd, safeTimezone } from "./time";

export const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
/** How long a claimed row may stay "sending" before a later run treats the send as interrupted. */
export const CLAIM_MS = 2 * 60_000;
/** Notifications older than this are never delivered (after an outage, day-old news is noise). */
export const PLAN_WINDOW_MS = 24 * 3_600_000;
const PLAN_LIMIT = 500;
const SEND_LIMIT = 500;
/** Each university gets this much of a job run for sending; the rest waits for the next minute. */
const SEND_BUDGET_MS = 20_000;

/** Wait before the next try, after `attempts` tries: 1 min, 5 min, 30 min, then 2 hours. */
export function retryDelayMs(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1];
}

const isText = (c: Channel) => c === "sms" || c === "whatsapp";

/** When a text may go out: now, or 8 am if it's quiet hours (never held for security messages). */
export function readyAt(channel: Channel, security: boolean, timezone: string, at: Date): Date {
  return isText(channel) && !security ? quietHoursEnd(timezone, at) : at;
}

function uniOf(actor: Actor): string {
  if (!actor.universityId) throw new ValidationError("Delivery runs inside a university.");
  return actor.universityId;
}

export type RunOptions = {
  now?: Date;
  providers?: Providers;
  /** Milliseconds this run may spend sending. */
  budgetMs?: number;
  concurrency?: number;
};

export type DeliveryRow = typeof notifDeliveries.$inferSelect;
export type DeliveryInsert = typeof notifDeliveries.$inferInsert;

/* ───────────────────────────── Planning ───────────────────────────── */

export type PlanResult = { notifications: number; deliveries: number; skipped: number };

/** Claims new core notifications and creates their deliveries. Safe to run concurrently. */
export async function planDeliveries(actor: Actor, opts: RunOptions = {}): Promise<PlanResult> {
  const universityId = uniOf(actor);
  assertCan(actor, "settings.manage", { universityId });
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const settings = await ensureUniversitySettings(tx, universityId, now);
    const from = new Date(Math.max(settings.deliverFrom.getTime(), now.getTime() - PLAN_WINDOW_MS));
    const candidates = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          gte(notifications.createdAt, from),
          sql`not exists (select 1 from ${notifDispatches} d where d.notification_id = ${notifications.id})`,
        ),
      )
      .orderBy(asc(notifications.createdAt), asc(notifications.id))
      .limit(PLAN_LIMIT);
    if (candidates.length === 0) return { notifications: 0, deliveries: 0, skipped: 0 };

    // The primary key decides who plans each notification: a run that overlaps waits for this
    // insert to commit, then gets nothing back for the rows already claimed here.
    const claimed = await tx
      .insert(notifDispatches)
      .values(candidates.map((c) => ({ notificationId: c.id, universityId, createdAt: now })))
      .onConflictDoNothing()
      .returning({ id: notifDispatches.notificationId });
    if (claimed.length === 0) return { notifications: 0, deliveries: 0, skipped: 0 };

    const rows = await tx
      .select()
      .from(notifications)
      .where(inArray(notifications.id, claimed.map((c) => c.id)))
      .orderBy(asc(notifications.createdAt), asc(notifications.id));
    const university = await universityLite(tx);
    const tz = safeTimezone(university.timezone);
    const kinds = [...new Set(rows.map((r) => r.kind))];
    const configs = await kindConfigs(tx, kinds);
    const people = await recipients(tx, universityId, rows.map((r) => r.userId));
    const prefs = await preferenceMap(tx, [...people.keys()], kinds);
    const suppressed = new Set(
      (
        await tx
          .select({ address: notifSuppressions.address, kind: notifSuppressions.kind })
          .from(notifSuppressions)
          .where(inArray(notifSuppressions.kind, kinds))
      ).map((s) => `${s.address}|${s.kind}`),
    );

    const values: DeliveryInsert[] = [];
    for (const n of rows) {
      const person = people.get(n.userId);
      if (!person) continue; // no longer visible in this university
      const cfg = configs.get(n.kind)!;
      const security = isSecurityKind(n.kind);
      const input = {
        university,
        person: { id: person.id, name: person.name, email: person.email, learner: person.learner },
        kind: n.kind,
        title: n.title,
        body: n.body,
        data: (n.data ?? {}) as Record<string, unknown>,
      };
      for (const channel of CHANNELS) {
        const allowed = security ? cfg.channels[channel] !== "off" : channelAllowed(cfg.channels[channel], prefs.get(prefKey(person.id, n.kind, channel)));
        if (!allowed) continue;
        const base = { universityId, source: "notification" as const, notificationId: n.id, userId: person.id, kind: n.kind, channel, security, createdAt: now, updatedAt: now };
        if (channel === "email") {
          const address = person.email.trim().toLowerCase();
          if (!security && suppressed.has(`${address}|${n.kind}`)) continue;
          values.push({ ...base, recipient: address, status: "queued", nextAttemptAt: now, payload: { ...renderEmail(input, cfg), replyTo: settings.replyTo } });
          continue;
        }
        const phone = toE164(person.phone);
        if (!phone) {
          values.push({ ...base, recipient: null, status: "skipped", lastError: "No valid mobile number on their profile." });
          continue;
        }
        values.push({ ...base, recipient: phone, status: "queued", nextAttemptAt: readyAt(channel, security, tz, now), payload: renderText(input, cfg) });
      }
    }
    if (values.length) await tx.insert(notifDeliveries).values(values).onConflictDoNothing();
    return {
      notifications: claimed.length,
      deliveries: values.filter((v) => v.status === "queued").length,
      skipped: values.filter((v) => v.status === "skipped").length,
    };
  });
}

/* ───────────────────────────── Sending ───────────────────────────── */

export type SendContext = { university: UniversityLite; timezone: string; configs: Map<string, KindConfig>; providers: Providers; now: Date };
export type SendOutcome = "sent" | "retry" | "failed" | "lost";
export type Content = { email?: OutboundEmail; text?: OutboundText };

/** The message for a stored row (security rows hold no text and are never sent from storage). */
function contentFromRow(row: DeliveryRow, ctx: SendContext): Content {
  const p = row.payload ?? {};
  if (!row.recipient) throw new ProviderError("No recipient.", false);
  if (p.redacted) throw new ProviderError("Security messages aren't stored, so this one can't be sent again.", false);
  if (row.channel === "email") {
    if (!p.subject || !p.html || !p.text) throw new ProviderError("The message has no content to send.", false);
    return {
      email: {
        to: row.recipient,
        subject: p.subject,
        html: p.html,
        text: p.text,
        replyTo: p.replyTo ?? null,
        headers: p.headers,
        kind: row.kind,
        fromName: ctx.university.name,
        idempotencyKey: idempotencyKey(row),
      },
    };
  }
  if (!p.text) throw new ProviderError("The message has no content to send.", false);
  const cfg = ctx.configs.get(row.kind);
  return {
    text: {
      to: row.recipient,
      text: p.text,
      kind: row.kind,
      vars: p.vars ?? { text: p.text },
      templateId: cfg?.smsTemplateId ?? null,
      whatsappTemplate: cfg?.whatsappTemplate ?? null,
    },
  };
}

export const idempotencyKey = (row: Pick<DeliveryRow, "id" | "failures">) => `zinny-notif-${row.id}-${row.failures}`;

/**
 * Calls the provider for a row this process has claimed (status "sending"), then records the
 * outcome. Only the claim that matches (same attempt) may record it.
 */
export async function sendClaimed(actor: Actor, row: DeliveryRow, ctx: SendContext, content?: Content): Promise<{ outcome: SendOutcome; error?: string }> {
  let result: { id: string | null } | null = null;
  let error: unknown = null;
  try {
    const m = content ?? contentFromRow(row, ctx);
    await pace(ctx.providers[row.channel].name);
    if (m.email) result = await ctx.providers.email.send(m.email);
    else if (row.channel === "sms") result = await ctx.providers.sms.send(m.text!);
    else result = await ctx.providers.whatsapp.send(m.text!);
  } catch (e) {
    error = e;
  }
  const finishedAt = new Date(Math.max(ctx.now.getTime(), Date.now()));
  const mine = and(eq(notifDeliveries.id, row.id), eq(notifDeliveries.status, "sending"), eq(notifDeliveries.attempts, row.attempts));

  if (result) {
    const done = await withTenant(actor, (tx) =>
      tx
        .update(notifDeliveries)
        .set({ status: "sent", sentAt: finishedAt, providerMessageId: result.id, lastError: null, lockedUntil: null, nextAttemptAt: null, updatedAt: finishedAt })
        .where(mine)
        .returning({ id: notifDeliveries.id }),
    );
    return { outcome: done.length ? "sent" : "lost" };
  }

  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  if (!(error instanceof ProviderError)) console.error(`[notifications] delivery ${row.id} failed unexpectedly:`, error);
  const retryable = !(error instanceof ProviderError) || error.retryable;
  // A 409 from Resend means the same key is still being processed: keep the key, so it can't go twice.
  const sameKey = error instanceof ProviderError && error.status === 409;
  const giveUp = !retryable || row.attempts >= MAX_ATTEMPTS || !!row.payload?.redacted;
  const next = giveUp ? null : readyAt(row.channel, row.security, ctx.timezone, new Date(ctx.now.getTime() + retryDelayMs(row.attempts)));
  const done = await withTenant(actor, (tx) =>
    tx
      .update(notifDeliveries)
      .set({
        status: giveUp ? "failed" : "queued",
        lastError: message,
        nextAttemptAt: next,
        lockedUntil: null,
        failures: sameKey ? row.failures : row.failures + 1,
        updatedAt: finishedAt,
      })
      .where(mine)
      .returning({ id: notifDeliveries.id }),
  );
  if (giveUp && done.length) console.error(`[notifications] delivery ${row.id} (${row.kind}, ${row.channel}) failed for good: ${message}`);
  return { outcome: done.length ? (giveUp ? "failed" : "retry") : "lost", error: message };
}

/** Claims one due row. Only one caller can win: the update re-checks the row's state under its lock. */
export async function claim(actor: Actor, id: string, providerName: string, ctx: SendContext): Promise<DeliveryRow | null> {
  const [row] = await withTenant(actor, (tx) =>
    tx
      .update(notifDeliveries)
      .set({
        status: "sending",
        attempts: sql`${notifDeliveries.attempts} + 1`,
        lockedUntil: new Date(Math.max(ctx.now.getTime(), Date.now()) + CLAIM_MS),
        provider: providerName,
        updatedAt: ctx.now,
      })
      .where(and(eq(notifDeliveries.id, id), eq(notifDeliveries.status, "queued"), lte(notifDeliveries.nextAttemptAt, ctx.now)))
      .returning(),
  );
  return row ?? null;
}

/** Rows left "sending" by a run that died: repeat only when the provider drops repeats; otherwise stop. */
async function recoverInterrupted(tx: Tx, now: Date): Promise<number> {
  const stale = await tx
    .select()
    .from(notifDeliveries)
    .where(and(eq(notifDeliveries.status, "sending"), lt(notifDeliveries.lockedUntil, now)))
    .limit(SEND_LIMIT)
    .for("update", { skipLocked: true });
  for (const r of stale) {
    const repeat = safeToRepeat(r.channel, r.provider ?? "") && !r.payload?.redacted && r.attempts < MAX_ATTEMPTS;
    await tx
      .update(notifDeliveries)
      .set(
        repeat
          ? { status: "queued", interrupted: true, nextAttemptAt: now, lockedUntil: null, lastError: "The previous send was interrupted. Trying again.", updatedAt: now }
          : {
              status: "failed",
              interrupted: true,
              nextAttemptAt: null,
              lockedUntil: null,
              lastError: "The send was interrupted and its outcome is unknown. It wasn't tried again, so it can't arrive twice.",
              updatedAt: now,
            },
      )
      .where(and(eq(notifDeliveries.id, r.id), eq(notifDeliveries.status, "sending")));
  }
  return stale.length;
}

export type SendResult = { sent: number; retried: number; failed: number; deferred: number; recovered: number };

/** Sends every due delivery of the actor's university, within the time budget. Safe to run concurrently. */
export async function sendDueDeliveries(actor: Actor, opts: RunOptions = {}): Promise<SendResult> {
  const universityId = uniOf(actor);
  assertCan(actor, "settings.manage", { universityId });
  const now = opts.now ?? new Date();
  const providers = opts.providers ?? activeProviders();
  const deadline = Date.now() + (opts.budgetMs ?? SEND_BUDGET_MS);
  const result: SendResult = { sent: 0, retried: 0, failed: 0, deferred: 0, recovered: 0 };

  const prep = await withTenant(actor, async (tx) => {
    result.recovered = await recoverInterrupted(tx, now);
    const university = await universityLite(tx);
    const timezone = safeTimezone(university.timezone);
    if (isQuietHours(timezone, now)) {
      // Texts that came due during quiet hours (after an outage, say) wait for the morning.
      const moved = await tx
        .update(notifDeliveries)
        .set({ nextAttemptAt: quietHoursEnd(timezone, now), updatedAt: now })
        .where(
          and(
            eq(notifDeliveries.status, "queued"),
            inArray(notifDeliveries.channel, ["sms", "whatsapp"]),
            eq(notifDeliveries.security, false),
            lte(notifDeliveries.nextAttemptAt, now),
          ),
        )
        .returning({ id: notifDeliveries.id });
      result.deferred = moved.length;
    }
    const due = await tx
      .select({ id: notifDeliveries.id, kind: notifDeliveries.kind, channel: notifDeliveries.channel })
      .from(notifDeliveries)
      .where(and(eq(notifDeliveries.status, "queued"), lte(notifDeliveries.nextAttemptAt, now)))
      .orderBy(asc(notifDeliveries.nextAttemptAt), asc(notifDeliveries.createdAt))
      .limit(SEND_LIMIT);
    const configs = await kindConfigs(tx, due.map((d) => d.kind));
    return { university, timezone, configs, due };
  });

  const ctx: SendContext = { university: prep.university, timezone: prep.timezone, configs: prep.configs, providers, now };
  const queue = [...prep.due];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      // Stop when the time is up; the rest waits for the next run. Sends are paced to the provider's rate.
      if (Date.now() > deadline) return;
      const row = await claim(actor, next.id, providers[next.channel].name, ctx);
      if (!row) continue; // another run has it
      const { outcome } = await sendClaimed(actor, row, ctx);
      if (outcome === "sent") result.sent++;
      if (outcome === "retry") result.retried++;
      if (outcome === "failed") result.failed++;
    }
  };
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? (Number(process.env.NOTIFICATIONS_SEND_CONCURRENCY) || 2)));
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

export type JobResult = PlanResult & SendResult;

/** The every-minute job for one university. */
export async function runDeliveryJob(actor: Actor, opts: RunOptions = {}): Promise<JobResult> {
  const plan = await planDeliveries(actor, opts);
  const send = await sendDueDeliveries(actor, opts);
  const result = { ...plan, ...send };
  if (plan.notifications || send.sent || send.failed || send.retried || send.recovered || send.deferred) {
    await withTenant(actor, (tx) => audit(tx, actor, "notifications.delivery_run", "notif_deliveries", null, result));
  }
  return result;
}

/** Daily: deletes dispatch markers past the planning window and finished deliveries older than 180 days. */
export async function cleanupDeliveries(actor: Actor, now = new Date()) {
  const universityId = uniOf(actor);
  assertCan(actor, "settings.manage", { universityId });
  return withTenant(actor, async (tx) => {
    const dispatches = await tx
      .delete(notifDispatches)
      .where(lt(notifDispatches.createdAt, new Date(now.getTime() - 3 * PLAN_WINDOW_MS)))
      .returning({ id: notifDispatches.notificationId });
    const deliveries = await tx
      .delete(notifDeliveries)
      .where(and(lt(notifDeliveries.createdAt, new Date(now.getTime() - 180 * 86_400_000)), inArray(notifDeliveries.status, ["sent", "failed", "skipped"])))
      .returning({ id: notifDeliveries.id });
    if (dispatches.length || deliveries.length) {
      await audit(tx, actor, "notifications.cleanup", "notif_deliveries", null, { dispatches: dispatches.length, deliveries: deliveries.length });
    }
    return { dispatches: dispatches.length, deliveries: deliveries.length };
  });
}

/* ───────────────────────────── Direct sends (the transports) ───────────────────────────── */

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const isEmailAddress = (s: string) => s.length <= 254 && EMAIL_RE.test(s);

/** The first code-like number in a text, for DLT templates whose variable is the code. */
const codeIn = (text: string) => /\b(\d{4,8})\b/.exec(text)?.[1] ?? "";

/** A row to record plus, when it goes out now, the content to send (kept in memory for security messages). */
export type Planned = { row: DeliveryInsert & { id: string }; content?: Content };

/**
 * Records direct sends and sends the ones that go out now. Others wait in the queue (quiet
 * hours) or were skipped (unsubscribed). Returns each row's outcome.
 */
export async function recordAndSend(actor: Actor, planned: Planned[], ctx: SendContext): Promise<{ id: string; status: DeliveryRow["status"]; outcome?: SendOutcome; error?: string | null }[]> {
  if (planned.length === 0) return [];
  const inserted = await withTenant(actor, async (tx) => {
    const rows = await tx.insert(notifDeliveries).values(planned.map((p) => p.row)).returning();
    for (const r of rows) {
      await audit(tx, actor, `notifications.${r.source}_send`, "notif_delivery", r.id, { kind: r.kind, channel: r.channel, status: r.status, security: r.security });
    }
    return rows;
  });
  const byId = new Map(inserted.map((r) => [r.id, r]));
  const out: { id: string; status: DeliveryRow["status"]; outcome?: SendOutcome; error?: string | null }[] = [];
  for (const p of planned) {
    const row = byId.get(p.row.id);
    if (!row) continue;
    if (row.status !== "sending") {
      out.push({ id: row.id, status: row.status, error: row.lastError });
      continue;
    }
    const { outcome, error } = await sendClaimed(actor, row, ctx, p.content);
    out.push({ id: row.id, status: outcome === "sent" ? "sent" : outcome === "retry" ? "queued" : "failed", outcome, error });
  }
  return out;
}

/** Direct sends: security messages that fail throw so the caller can tell the person; others are retried by the job. */
async function deliverDirect(actor: Actor, planned: Planned[], ctx: SendContext): Promise<{ id?: string }> {
  const results = await recordAndSend(actor, planned, ctx);
  const securityFailure = results.find((r, i) => planned[i]?.row.security && r.outcome === "failed");
  if (securityFailure) throw new Error(`The message couldn't be sent: ${securityFailure.error ?? "unknown error"}`);
  return { id: results[results.length - 1]?.id };
}

export async function directContext(tx: Tx, kinds: string[], providers: Providers, now: Date): Promise<SendContext> {
  const university = await universityLite(tx);
  return { university, timezone: safeTimezone(university.timezone), configs: await kindConfigs(tx, kinds), providers, now };
}

/** sendEmail() for every module, once registered as the mail transport. */
export async function sendDirectEmail(m: MailMessage, opts: RunOptions = {}): Promise<{ id?: string }> {
  const addresses = [...new Set((Array.isArray(m.to) ? m.to : [m.to]).map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean))];
  if (addresses.length === 0) throw new ValidationError("The email has no recipient.");
  const kind = m.kind?.trim() || "message";
  const security = isSecurityKind(kind);
  const providers = opts.providers ?? activeProviders();
  const now = opts.now ?? new Date();

  if (!m.universityId) {
    // Zinny team messages, outside any university: nothing to brand, record or unsubscribe from.
    const bad = addresses.find((a) => !isEmailAddress(a));
    if (bad) throw new ValidationError(`"${bad}" isn't a valid email address.`);
    if (providers.email.name === "console") {
      await consoleMailTransport.send(m);
      return {};
    }
    let id: string | null = null;
    for (const to of addresses) {
      ({ id } = await providers.email.send({ to, subject: oneLine(m.subject, 200), html: m.html, text: m.text, replyTo: m.replyTo, kind, idempotencyKey: `zinny-direct-${randomUUID()}` }));
    }
    return { id: id ?? undefined };
  }

  const actor = systemActorFor(m.universityId);
  const universityId = m.universityId;
  const { planned, ctx } = await withTenant(actor, async (tx) => {
    const ctx = await directContext(tx, [kind], providers, now);
    const cfg = ctx.configs.get(kind)!;
    const settings = await readUniversitySettings(tx, now);
    const planned: Planned[] = [];
    for (const address of addresses) {
      const id = randomUUID();
      const base = { id, universityId, source: "direct" as const, kind, channel: "email" as const, security, recipient: address.slice(0, 254), createdAt: now, updatedAt: now };
      if (!isEmailAddress(address)) {
        planned.push({ row: { ...base, status: "failed", lastError: "Not a valid email address." } });
        continue;
      }
      const person = await personByEmail(tx, universityId, address);
      if (!security) {
        const skip = await directSkipReason(tx, cfg, "email", person?.id ?? null, address, kind);
        if (skip) {
          planned.push({ row: { ...base, userId: person?.id ?? null, status: "skipped", lastError: skip } });
          continue;
        }
      }
      const footer = emailFooter(ctx.university, { personId: person?.id ?? null, email: address, learner: person?.learner ?? false }, kind, kindDefinition(kind).label);
      const { html, text } = decorateDirectEmail(m, { university: ctx.university, absolute: absoluteUrl, footer });
      const subject = oneLine(m.subject, 200);
      const replyTo = m.replyTo ?? settings.replyTo;
      const headers = unsubscribeHeaders(footer.unsubscribeUrl);
      const email: OutboundEmail = { to: address, subject, html, text, replyTo, headers, kind, fromName: ctx.university.name, idempotencyKey: idempotencyKey({ id, failures: 0 }) };
      planned.push({
        row: {
          ...base,
          userId: person?.id ?? null,
          status: "sending",
          attempts: 1,
          lockedUntil: new Date(now.getTime() + CLAIM_MS),
          provider: providers.email.name,
          // Security messages (codes, reset and invite links) are sent from memory and never stored.
          payload: security ? { redacted: true, subject } : { subject, html, text, replyTo, headers },
        },
        content: { email },
      });
    }
    return { planned, ctx };
  });
  return deliverDirect(actor, planned, ctx);
}

/** Why a non-security direct message isn't sent, or null when it should go. */
async function directSkipReason(tx: Tx, cfg: KindConfig, channel: Channel, personId: string | null, address: string | null, kind: string): Promise<string | null> {
  const pref = personId ? (await preferenceMap(tx, [personId], [kind])).get(prefKey(personId, kind, channel)) : undefined;
  if (pref === false) return channel === "email" ? "They unsubscribed from these emails." : "They turned these messages off.";
  // The admin's settings apply to kinds they configured and to core kinds. Another module's
  // kind that nobody configured goes out: that module chose to send it on this channel.
  if ((cfg.saved || isCoreKind(kind)) && !channelAllowed(cfg.channels[channel], pref)) return "Turned off in the institute's notification settings.";
  if (channel === "email" && address && (await isSuppressed(tx, address, kind))) return "They unsubscribed from these emails.";
  return null;
}

/** sendSms() for every module, once registered as the SMS transport. */
export async function sendDirectSms(m: SmsMessage, opts: RunOptions = {}): Promise<{ id?: string }> {
  return sendDirectText("sms", m, opts);
}

/** SMS or WhatsApp to one number, as sendSms does. */
export async function sendDirectText(channel: "sms" | "whatsapp", m: SmsMessage, opts: RunOptions = {}): Promise<{ id?: string }> {
  const kind = m.kind?.trim() || "message";
  const security = isSecurityKind(kind);
  const providers = opts.providers ?? activeProviders();
  const now = opts.now ?? new Date();
  const phone = toE164(m.to);
  const text = oneLine(String(m.text ?? ""), 1000);
  if (!text) throw new ValidationError("The message is empty.");

  if (!m.universityId) {
    if (!phone) throw new ValidationError(`"${m.to}" isn't a valid mobile number.`);
    if (providers[channel].name === "console") {
      if (channel === "sms") await consoleSmsTransport.send({ ...m, to: phone });
      else await providers.whatsapp.send({ to: phone, text, kind, vars: { text } });
      return {};
    }
    const { id } = await providers[channel].send({ to: phone, text, kind, vars: { text, code: codeIn(text) } });
    return { id: id ?? undefined };
  }

  const actor = systemActorFor(m.universityId);
  const universityId = m.universityId;
  const { planned, ctx } = await withTenant(actor, async (tx) => {
    const ctx = await directContext(tx, [kind], providers, now);
    const cfg = ctx.configs.get(kind)!;
    const id = randomUUID();
    const base = { id, universityId, source: "direct" as const, kind, channel, security, createdAt: now, updatedAt: now };
    if (!phone) {
      if (security) throw new ValidationError(`"${m.to}" isn't a valid mobile number.`);
      return { ctx, planned: [{ row: { ...base, recipient: String(m.to ?? "").slice(0, 32), status: "failed" as const, lastError: "Not a valid mobile number." } }] };
    }
    const vars = { text, code: codeIn(text), university: oneLine(ctx.university.name, 60) };
    const content: Content = { text: { to: phone, text, kind, vars, templateId: cfg.smsTemplateId, whatsappTemplate: cfg.whatsappTemplate } };
    const sending = { status: "sending" as const, attempts: 1, lockedUntil: new Date(now.getTime() + CLAIM_MS), provider: providers[channel].name };
    if (security) {
      return { ctx, planned: [{ row: { ...base, recipient: phone, ...sending, payload: { redacted: true } }, content }] };
    }
    const owner = await phoneOwner(tx, phone);
    const skip = await directSkipReason(tx, cfg, channel, owner, null, kind);
    if (skip) return { ctx, planned: [{ row: { ...base, userId: owner, recipient: phone, status: "skipped" as const, lastError: skip } }] };
    if (isQuietHours(ctx.timezone, now)) {
      return { ctx, planned: [{ row: { ...base, userId: owner, recipient: phone, status: "queued" as const, nextAttemptAt: quietHoursEnd(ctx.timezone, now), payload: { text, vars } } }] };
    }
    return { ctx, planned: [{ row: { ...base, userId: owner, recipient: phone, ...sending, payload: { text, vars } }, content }] };
  });
  return deliverDirect(actor, planned, ctx);
}

/** The one person in this university with this mobile number, if exactly one has it. */
async function phoneOwner(tx: Tx, e164: string): Promise<string | null> {
  const digits = e164.slice(1);
  const national = e164.startsWith("+91") ? e164.slice(3) : digits;
  const rows = await tx.execute<{ id: string }>(
    sql`select u.id from users u
        where u.phone is not null
          and regexp_replace(u.phone, '[^0-9]', '', 'g') in (${digits}, ${national}, ${`0${national}`})
          and exists (select 1 from role_assignments ra where ra.user_id = u.id and ra.university_id = zinny_current_university() and ra.revoked_at is null)
        limit 2`,
  );
  const list = Array.from(rows as unknown as { id: string }[]);
  return list.length === 1 ? list[0].id : null;
}

/** The record of a message, for the admin log. */
export type DeliveryView = Pick<
  DeliveryRow,
  "id" | "source" | "kind" | "channel" | "security" | "recipient" | "status" | "lastError" | "attempts" | "nextAttemptAt" | "provider" | "createdAt" | "sentAt" | "userId"
> & { subject: string | null; retryable: boolean };

export function toView(r: DeliveryRow): DeliveryView {
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    channel: r.channel,
    security: r.security,
    recipient: r.recipient,
    status: r.status,
    lastError: r.lastError,
    attempts: r.attempts,
    nextAttemptAt: r.nextAttemptAt,
    provider: r.provider,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    userId: r.userId,
    subject: r.payload?.subject ?? (r.channel === "email" ? null : (r.payload?.text ?? null)),
    retryable: r.status === "failed" && !r.interrupted && !r.payload?.redacted && !!r.recipient && !!(r.channel === "email" ? r.payload?.html : r.payload?.text),
  };
}

export { type DeliveryPayload };
