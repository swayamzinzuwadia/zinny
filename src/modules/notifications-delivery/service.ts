/**
 * Notification settings: the institute's defaults and templates per kind (settings.manage),
 * each person's own preferences (self.profile), test sends, the delivery log and unsubscribe
 * links. Delivery itself lives in delivery.ts.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { notifications, roleAssignments, users } from "@/db/schema";
import { assertCan, audit, peopleLite, systemActorFor, universityLite, withTenant, type Actor, type UniversityLite } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { verifyToken } from "./config";
import { CLAIM_MS, directContext, isEmailAddress, recordAndSend, toView, type DeliveryView, type Planned } from "./delivery";
import {
  CHANNEL_LABEL,
  CHANNELS,
  CORE_KINDS,
  isCoreKind,
  isSecurityKind,
  KIND_PATTERN,
  kindDefinition,
  SECURITY_KINDS_CATALOGUE,
  type Audience,
  type ChannelDefaults,
} from "./kinds";
import { renderEmail, renderText } from "./messages";
import { maskPhone, toE164 } from "./phone";
import { activeProviders, providerStatus } from "./providers";
import { unknownVariables } from "./render";
import {
  notifDeliveries,
  notifKindSettings,
  notifPreferences,
  notifSuppressions,
  notifUniversitySettings,
  type Channel,
  type ChannelState,
  type DeliveryStatus,
} from "./schema";
import { channelAllowed, configFrom, FIRST_RUN_LOOKBACK_MS, kindConfigs, preferenceMap, prefKey, readUniversitySettings, type KindConfig } from "./store";

function uni(actor: Actor): string {
  if (!actor.universityId) throw new ValidationError("Open a university first.");
  return actor.universityId;
}

const STATES: readonly ChannelState[] = ["off", "optional", "on"];
const LIMITS = { subject: 200, body: 5000, sms: 480, templateId: 100, replyTo: 254 };

function assertKind(kind: string) {
  if (!KIND_PATTERN.test(kind)) throw new ValidationError("That notification kind doesn't exist.");
}

/** Kinds this university has seen: core ones, configured ones, and any other module's kinds that were sent. */
async function knownKinds(tx: Tx): Promise<string[]> {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const configured = await tx.select({ kind: notifKindSettings.kind }).from(notifKindSettings);
  const notified = await tx.selectDistinct({ kind: notifications.kind }).from(notifications).where(gte(notifications.createdAt, since));
  const direct = await tx.selectDistinct({ kind: notifDeliveries.kind }).from(notifDeliveries).where(gte(notifDeliveries.createdAt, since));
  const all = new Set<string>([
    ...CORE_KINDS.map((k) => k.kind),
    ...SECURITY_KINDS_CATALOGUE.map((k) => k.kind),
    ...configured.map((r) => r.kind),
    ...notified.map((r) => r.kind),
    ...direct.map((r) => r.kind),
  ]);
  return [...all].filter((k) => KIND_PATTERN.test(k));
}

const order = (k: string) => {
  const core = CORE_KINDS.findIndex((c) => c.kind === k);
  if (core >= 0) return core;
  return isSecurityKind(k) ? 2000 : 1000;
};

/* ───────────────────────────── Institute settings ───────────────────────────── */

export type KindSummary = {
  kind: string;
  label: string;
  description: string;
  audience: Audience;
  core: boolean;
  security: boolean;
  channels: ChannelDefaults;
  customized: boolean;
  smsTemplateId: string | null;
  whatsappTemplate: string | null;
};

const summary = (c: KindConfig): KindSummary => ({
  kind: c.def.kind,
  label: c.def.label,
  description: c.def.description,
  audience: c.def.audience,
  core: isCoreKind(c.def.kind),
  security: isSecurityKind(c.def.kind),
  channels: c.channels,
  customized: c.customized.emailSubject || c.customized.emailBody || c.customized.smsText,
  smsTemplateId: c.smsTemplateId,
  whatsappTemplate: c.whatsappTemplate,
});

export async function getInstituteSettings(actor: Actor) {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  return withTenant(actor, async (tx) => {
    const university = await universityLite(tx);
    const settings = await readUniversitySettings(tx, new Date());
    const kinds = (await knownKinds(tx)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    const configs = await kindConfigs(tx, kinds);
    return {
      university,
      replyTo: settings.replyTo,
      providers: providerStatus(),
      kinds: kinds.map((k) => summary(configs.get(k)!)),
    };
  });
}

export type KindEditor = KindSummary & {
  template: KindConfig["template"];
  defaults: { channels: ChannelDefaults; template: KindConfig["template"] };
  customizedFields: KindConfig["customized"];
  updatedAt: Date | null;
  preview: { subject: string; html: string; text: string; sms: string };
};

/** One kind's settings with a preview of the email and text as the admin would receive them. */
export async function getKindEditor(actor: Actor, kind: string): Promise<KindEditor> {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  assertKind(kind);
  return withTenant(actor, async (tx) => {
    const university = await universityLite(tx);
    const cfg = (await kindConfigs(tx, [kind])).get(kind)!;
    const sample = sampleInput(university, actor, kind);
    const email = renderEmail(sample, cfg);
    return {
      ...summary(cfg),
      template: cfg.template,
      defaults: { channels: cfg.def.defaults, template: cfg.def.template },
      customizedFields: cfg.customized,
      updatedAt: cfg.updatedAt,
      preview: { subject: email.subject, html: email.html, text: email.text, sms: renderText(sample, cfg).text },
    };
  });
}

function sampleInput(university: UniversityLite, actor: Actor, kind: string) {
  const def = kindDefinition(kind);
  return {
    university,
    person: { id: actor.userId || null, name: actor.name, email: actor.email, learner: def.audience === "learners" },
    kind,
    title: def.sample.title,
    body: def.sample.body,
    data: def.sample.data ?? {},
  };
}

export type KindSettingsInput = {
  channels?: Partial<Record<Channel, string>>;
  emailSubject?: string;
  emailBody?: string;
  smsText?: string;
  smsTemplateId?: string;
  whatsappTemplate?: string;
};

function checkTemplate(label: string, value: string, max: number) {
  if (value.length > max) throw new ValidationError(`${label} is too long. Keep it under ${max} characters.`);
  const bad = unknownVariables(value);
  if (bad.length) {
    throw new ValidationError(
      `${label} uses ${bad.map((b) => (b.startsWith("{") ? "unbalanced braces" : `{{${b}}}`)).join(", ")}, which isn't a variable. Use {{name}}, {{firstName}}, {{title}}, {{body}}, {{university}} or {{link}}.`,
    );
  }
}

/** Saves a kind's channel defaults, template text and provider template ids. Text equal to the default is stored as "use the default". */
export async function saveKindSettings(actor: Actor, kind: string, input: KindSettingsInput) {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  assertKind(kind);
  const def = kindDefinition(kind);
  const security = isSecurityKind(kind);

  const channels = { ...def.defaults };
  for (const c of CHANNELS) {
    const v = input.channels?.[c];
    if (v === undefined || v === "") continue;
    if (!STATES.includes(v as ChannelState)) throw new ValidationError(`Pick off, optional or on for ${CHANNEL_LABEL[c]}.`);
    channels[c] = v as ChannelState;
  }
  const norm = (v: string | undefined) => (v ?? "").replace(/\r\n/g, "\n").trim();
  const subject = norm(input.emailSubject);
  const body = norm(input.emailBody);
  const sms = norm(input.smsText);
  if (!security) {
    if (!subject) throw new ValidationError("Write an email subject, or put back the default: {{title}}.");
    if (!body) throw new ValidationError("Write the email text. {{body}} adds the notification's details.");
    if (!sms) throw new ValidationError("Write the text message. {{title}} adds the notification's headline.");
    checkTemplate("The subject", subject, LIMITS.subject);
    checkTemplate("The email text", body, LIMITS.body);
    checkTemplate("The text message", sms, LIMITS.sms);
  }
  const templateId = norm(input.smsTemplateId);
  const waTemplate = norm(input.whatsappTemplate);
  if (templateId && !/^[A-Za-z0-9_-]{1,100}$/.test(templateId)) throw new ValidationError("The MSG91 template id has only letters, numbers, dashes and underscores. Copy it from MSG91's SMS templates page.");
  if (waTemplate && !/^[a-z0-9_]{1,100}$/.test(waTemplate)) throw new ValidationError("WhatsApp template names have only lower-case letters, numbers and underscores. Copy it from MSG91.");

  const row = {
    universityId,
    kind,
    email: security ? def.defaults.email : channels.email,
    sms: security ? def.defaults.sms : channels.sms,
    whatsapp: security ? def.defaults.whatsapp : channels.whatsapp,
    emailSubject: security || subject === def.template.emailSubject ? null : subject,
    emailBody: security || body === def.template.emailBody ? null : body,
    smsText: security || sms === def.template.smsText ? null : sms,
    smsTemplateId: templateId || null,
    whatsappTemplate: waTemplate || null,
    updatedBy: actor.userId || null,
    updatedAt: new Date(),
  };
  return withTenant(actor, async (tx) => {
    const [saved] = await tx
      .insert(notifKindSettings)
      .values(row)
      .onConflictDoUpdate({
        target: [notifKindSettings.universityId, notifKindSettings.kind],
        set: {
          email: row.email,
          sms: row.sms,
          whatsapp: row.whatsapp,
          emailSubject: row.emailSubject,
          emailBody: row.emailBody,
          smsText: row.smsText,
          smsTemplateId: row.smsTemplateId,
          whatsappTemplate: row.whatsappTemplate,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        },
      })
      .returning();
    await audit(tx, actor, "notifications.kind_settings", "notif_kind_settings", saved.id, {
      kind,
      channels: { email: row.email, sms: row.sms, whatsapp: row.whatsapp },
      customTemplate: !!(row.emailSubject || row.emailBody || row.smsText),
      smsTemplateId: row.smsTemplateId,
      whatsappTemplate: row.whatsappTemplate,
    });
    return configFrom(def, saved);
  });
}

/** Puts back the default channels and text for a kind (keeps provider template ids). */
export async function resetKindSettings(actor: Actor, kind: string) {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  assertKind(kind);
  const def = kindDefinition(kind);
  return withTenant(actor, async (tx) => {
    const [saved] = await tx
      .update(notifKindSettings)
      .set({ ...def.defaults, emailSubject: null, emailBody: null, smsText: null, updatedBy: actor.userId || null, updatedAt: new Date() })
      .where(eq(notifKindSettings.kind, kind))
      .returning();
    if (saved) await audit(tx, actor, "notifications.kind_reset", "notif_kind_settings", saved.id, { kind });
    return configFrom(def, saved ?? null);
  });
}

export async function saveDeliverySettings(actor: Actor, input: { replyTo?: string }) {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  const replyTo = (input.replyTo ?? "").trim().toLowerCase();
  if (replyTo && (replyTo.length > LIMITS.replyTo || !isEmailAddress(replyTo))) {
    throw new ValidationError("That reply-to address doesn't look right. Use a full address like office@youruniversity.edu, or leave it empty.");
  }
  return withTenant(actor, async (tx) => {
    const now = new Date();
    await tx
      .insert(notifUniversitySettings)
      .values({ universityId, replyTo: replyTo || null, updatedBy: actor.userId || null, updatedAt: now, deliverFrom: new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS) })
      .onConflictDoUpdate({ target: notifUniversitySettings.universityId, set: { replyTo: replyTo || null, updatedBy: actor.userId || null, updatedAt: now } });
    await audit(tx, actor, "notifications.delivery_settings", "notif_university_settings", universityId, { replyTo: replyTo || null });
    return { replyTo: replyTo || null };
  });
}

/* ───────────────────────────── Test sends ───────────────────────────── */

export type TestSendResult = { status: DeliveryStatus; to: string; provider: string; error?: string | null };

/** Sends the saved message for a kind to the admin themselves, now (their own request, so no quiet hours). */
export async function sendTestMessage(actor: Actor, kind: string, channel: Channel): Promise<TestSendResult> {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  assertKind(kind);
  if (!CHANNELS.includes(channel)) throw new ValidationError("Pick email, SMS or WhatsApp.");
  if (!actor.userId) throw new ValidationError("Sign in as a person to send yourself a test.");
  const providers = activeProviders();
  const now = new Date();
  const { planned, ctx, to } = await withTenant(actor, async (tx) => {
    const ctx = await directContext(tx, [kind], providers, now);
    const cfg = ctx.configs.get(kind)!;
    const sample = sampleInput(ctx.university, actor, kind);
    const settings = await readUniversitySettings(tx, now);
    const id = randomUUID();
    const base = {
      id,
      universityId,
      source: "test" as const,
      userId: actor.userId,
      kind,
      channel,
      security: false,
      createdAt: now,
      updatedAt: now,
      status: "sending" as const,
      attempts: 1,
      lockedUntil: new Date(now.getTime() + CLAIM_MS),
      provider: providers[channel].name,
    };
    if (channel === "email") {
      const to = actor.email.trim().toLowerCase();
      const email = renderEmail(sample, cfg);
      const subject = `[Test] ${email.subject}`.slice(0, 200);
      const payload = { ...email, subject, replyTo: settings.replyTo };
      const planned: Planned[] = [
        {
          row: { ...base, recipient: to, payload },
          content: { email: { to, subject, html: email.html, text: email.text, replyTo: settings.replyTo, headers: email.headers, kind, fromName: ctx.university.name, idempotencyKey: `zinny-notif-${id}-0` } },
        },
      ];
      return { planned, ctx, to };
    }
    const [me] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, actor.userId));
    const phone = toE164(me?.phone);
    if (!phone) throw new ValidationError("Your profile has no mobile number. Add one in your profile, then send the test again.");
    const text = renderText(sample, cfg);
    const planned: Planned[] = [
      {
        row: { ...base, recipient: phone, payload: text },
        content: { text: { to: phone, text: text.text, kind, vars: text.vars, templateId: cfg.smsTemplateId, whatsappTemplate: cfg.whatsappTemplate } },
      },
    ];
    return { planned, ctx, to: maskPhone(phone) };
  });
  const [r] = await recordAndSend(actor, planned, ctx);
  return { status: r.status, to, provider: providers[channel].name, error: r.error };
}

/* ───────────────────────────── Delivery log ───────────────────────────── */

export type DeliveryLogFilter = { status?: DeliveryStatus | ""; channel?: Channel | ""; limit?: number };

export async function listDeliveries(actor: Actor, filter: DeliveryLogFilter = {}) {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(notifDeliveries)
      .where(
        and(
          filter.status ? eq(notifDeliveries.status, filter.status) : undefined,
          filter.channel ? eq(notifDeliveries.channel, filter.channel) : undefined,
        ),
      )
      .orderBy(desc(notifDeliveries.createdAt), desc(notifDeliveries.id))
      .limit(limit);
    const people = new Map((await peopleLite(tx, rows.flatMap((r) => (r.userId ? [r.userId] : [])))).map((p) => [p.id, p.name]));
    const since = new Date(Date.now() - 7 * 86_400_000);
    const counts = await tx
      .select({ status: notifDeliveries.status, n: sql<number>`count(*)::int` })
      .from(notifDeliveries)
      .where(gte(notifDeliveries.createdAt, since))
      .groupBy(notifDeliveries.status);
    const stats = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<DeliveryStatus, number>>;
    return {
      stats: { sent: stats.sent ?? 0, queued: (stats.queued ?? 0) + (stats.sending ?? 0), failed: stats.failed ?? 0, skipped: stats.skipped ?? 0 },
      rows: rows.map((r) => ({
        ...toView(r),
        personName: r.userId ? (people.get(r.userId) ?? null) : null,
        label: kindDefinition(r.kind).label,
        recipient: r.recipient && r.channel !== "email" ? maskPhone(r.recipient) : r.recipient,
      })),
    };
  });
}

export type DeliveryLogRow = DeliveryView & { personName: string | null; label: string };

/**
 * Sends a failed delivery again, from the start of its retry schedule. Only for deliveries the
 * provider refused: a send whose outcome is unknown (interrupted) or a security message can't
 * be repeated, so it can never arrive twice.
 */
export async function retryDelivery(actor: Actor, deliveryId: string) {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  return withTenant(actor, async (tx) => {
    const [row] = await tx.select().from(notifDeliveries).where(eq(notifDeliveries.id, deliveryId)).for("update");
    if (!row) throw new NotFoundError("Delivery");
    const view = toView(row);
    if (!view.retryable) throw new ValidationError("Only failed messages with their content saved can be sent again.");
    if (row.attempts !== row.failures) {
      throw new ValidationError("This send was interrupted, so it may have arrived already. It can't be sent again, so nobody gets it twice.");
    }
    const now = new Date();
    await tx
      .update(notifDeliveries)
      .set({ status: "queued", attempts: 0, failures: row.failures, nextAttemptAt: now, lastError: null, lockedUntil: null, updatedAt: now })
      .where(eq(notifDeliveries.id, deliveryId));
    await audit(tx, actor, "notifications.retry", "notif_delivery", deliveryId, { kind: row.kind, channel: row.channel });
    return { id: deliveryId };
  });
}

/* ───────────────────────────── Personal preferences ───────────────────────────── */

export type PreferenceCell = {
  channel: Channel;
  /** The institute's setting for this kind and channel. */
  state: ChannelState;
  enabled: boolean;
  /** False when the institute turned the channel off for this kind. */
  editable: boolean;
};
export type PreferenceRow = { kind: string; label: string; description: string; channels: PreferenceCell[] };

const LEARNER_ROLES = new Set(["student", "alumni", "parent", "individual_learner"]);

/** What a person can choose, per kind and channel, within the institute's settings. */
export async function getPreferences(actor: Actor, userId: string) {
  const universityId = uni(actor);
  assertCan(actor, "self.profile", { universityId, ownerUserId: userId });
  return withTenant(actor, async (tx) => {
    const roles = await tx
      .select({ role: roleAssignments.role })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.universityId, universityId), sql`${roleAssignments.revokedAt} is null`));
    const audiences = new Set<Audience>(roles.map((r) => (LEARNER_ROLES.has(r.role) ? "learners" : "staff")));
    const received = await tx
      .selectDistinct({ kind: notifications.kind })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, new Date(Date.now() - 180 * 86_400_000))));
    const direct = await tx
      .selectDistinct({ kind: notifDeliveries.kind })
      .from(notifDeliveries)
      .where(and(eq(notifDeliveries.userId, userId), eq(notifDeliveries.source, "direct")));
    const kinds = [
      ...new Set([
        ...CORE_KINDS.filter((k) => audiences.has(k.audience)).map((k) => k.kind),
        ...received.map((r) => r.kind),
        ...direct.map((r) => r.kind),
      ]),
    ]
      .filter((k) => KIND_PATTERN.test(k) && !isSecurityKind(k))
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    const configs = await kindConfigs(tx, kinds);
    const prefs = await preferenceMap(tx, [userId], kinds);
    const [me] = await tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId));
    const university = await universityLite(tx);
    const rows: PreferenceRow[] = kinds.map((k) => {
      const cfg = configs.get(k)!;
      return {
        kind: k,
        label: cfg.def.label,
        description: cfg.def.description,
        channels: CHANNELS.map((c) => ({
          channel: c,
          state: cfg.channels[c],
          enabled: channelAllowed(cfg.channels[c], prefs.get(prefKey(userId, k, c))),
          editable: cfg.channels[c] !== "off",
        })),
      };
    });
    return {
      university,
      email: me?.email ?? null,
      phone: toE164(me?.phone) ? maskPhone(toE164(me?.phone)!) : null,
      rows,
    };
  });
}

export type PreferenceInput = { kind: string; channel: Channel; enabled: boolean };

/**
 * Saves a person's choices. Only their own (self.profile on their own record), and only where
 * the institute allows the channel. A choice equal to the institute's default is stored as
 * "follow the default", so later changes by the institute still reach them.
 */
export async function savePreferences(actor: Actor, userId: string, entries: PreferenceInput[]) {
  const universityId = uni(actor);
  assertCan(actor, "self.profile", { universityId, ownerUserId: userId });
  if (entries.length > 500) throw new ValidationError("Too many settings at once.");
  for (const e of entries) {
    assertKind(e.kind);
    if (!CHANNELS.includes(e.channel)) throw new ValidationError("Pick email, SMS or WhatsApp.");
    if (isSecurityKind(e.kind)) throw new ValidationError("Security messages, like sign-in codes, are always sent.");
  }
  return withTenant(actor, async (tx) => {
    const configs = await kindConfigs(tx, entries.map((e) => e.kind));
    const now = new Date();
    let changed = 0;
    for (const e of entries) {
      const state = configs.get(e.kind)!.channels[e.channel];
      if (state === "off") {
        if (e.enabled) throw new ValidationError(`Your institute has turned off ${CHANNEL_LABEL[e.channel]} for ${configs.get(e.kind)!.def.label.toLowerCase()}.`);
        continue;
      }
      const followsDefault = (state === "on") === e.enabled;
      const where = and(eq(notifPreferences.userId, userId), eq(notifPreferences.kind, e.kind), eq(notifPreferences.channel, e.channel));
      if (followsDefault) {
        const gone = await tx.delete(notifPreferences).where(where).returning({ id: notifPreferences.id });
        changed += gone.length;
      } else {
        const [prev] = await tx.select({ enabled: notifPreferences.enabled }).from(notifPreferences).where(where);
        if (prev?.enabled === e.enabled) continue;
        await tx
          .insert(notifPreferences)
          .values({ universityId, userId, kind: e.kind, channel: e.channel, enabled: e.enabled, updatedAt: now })
          .onConflictDoUpdate({
            target: [notifPreferences.universityId, notifPreferences.userId, notifPreferences.kind, notifPreferences.channel],
            set: { enabled: e.enabled, updatedAt: now },
          });
        changed++;
      }
      if (e.channel === "email" && e.enabled) {
        // Turning email back on also lifts an unsubscribe made from a link.
        const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
        if (me) await tx.delete(notifSuppressions).where(and(eq(notifSuppressions.address, me.email.toLowerCase()), eq(notifSuppressions.kind, e.kind)));
      }
    }
    if (changed) {
      await audit(tx, actor, "notifications.preferences", "user", userId, {
        changes: entries.map((e) => `${e.kind}:${e.channel}:${e.enabled ? "on" : "off"}`).slice(0, 100),
      });
    }
    return { changed };
  });
}

/* ───────────────────────────── Unsubscribe links ───────────────────────────── */

export type UnsubscribeView = {
  university: UniversityLite;
  kind: string;
  label: string;
  /** Masked address the link is for. */
  recipient: string;
  subscribed: boolean;
};

/**
 * Reads or applies an unsubscribe link. The signed token is the permission: it names the
 * university, the person (or address) and the kind. Runs as the university's system actor,
 * because the person clicking it may not be signed in.
 */
export async function unsubscribeLink(token: string, slug: string, action: "view" | "unsubscribe" | "resubscribe"): Promise<UnsubscribeView | null> {
  const claim = verifyToken(token);
  if (!claim || isSecurityKind(claim.k) || !KIND_PATTERN.test(claim.k)) return null;
  const system = systemActorFor(claim.u);
  return withTenant(system, async (tx) => {
    const university = await universityLite(tx).catch(() => null);
    if (!university || university.slug !== slug) return null;
    let address = claim.a ?? null;
    if (claim.p) {
      const [p] = await tx.select({ email: users.email }).from(users).where(eq(users.id, claim.p));
      if (!p) return null;
      address = p.email.toLowerCase();
    }
    if (!address) return null;
    const now = new Date();
    if (action !== "view") {
      const enabled = action === "resubscribe";
      if (claim.p) {
        const cfg = (await kindConfigs(tx, [claim.k])).get(claim.k)!;
        const followsDefault = (cfg.channels.email === "on") === enabled;
        const where = and(eq(notifPreferences.userId, claim.p), eq(notifPreferences.kind, claim.k), eq(notifPreferences.channel, "email"));
        if (followsDefault) await tx.delete(notifPreferences).where(where);
        else {
          await tx
            .insert(notifPreferences)
            .values({ universityId: claim.u, userId: claim.p, kind: claim.k, channel: "email", enabled, updatedAt: now })
            .onConflictDoUpdate({
              target: [notifPreferences.universityId, notifPreferences.userId, notifPreferences.kind, notifPreferences.channel],
              set: { enabled, updatedAt: now },
            });
        }
      }
      if (enabled) {
        await tx.delete(notifSuppressions).where(and(eq(notifSuppressions.address, address), eq(notifSuppressions.kind, claim.k)));
      } else {
        await tx.insert(notifSuppressions).values({ universityId: claim.u, address, kind: claim.k, createdAt: now }).onConflictDoNothing();
      }
      await audit(tx, system, enabled ? "notifications.resubscribe" : "notifications.unsubscribe", claim.p ? "user" : "email", claim.p ?? null, {
        kind: claim.k,
        via: "email link",
      });
    }
    const [suppressed] = await tx
      .select({ id: notifSuppressions.id })
      .from(notifSuppressions)
      .where(and(eq(notifSuppressions.address, address), eq(notifSuppressions.kind, claim.k)));
    let subscribed = !suppressed;
    if (subscribed && claim.p) {
      const cfg = (await kindConfigs(tx, [claim.k])).get(claim.k)!;
      const pref = (await preferenceMap(tx, [claim.p], [claim.k])).get(prefKey(claim.p, claim.k, "email"));
      subscribed = channelAllowed(cfg.channels.email, pref);
    }
    const [local, domain] = address.split("@");
    return {
      university,
      kind: claim.k,
      label: kindDefinition(claim.k).label,
      recipient: `${local.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, local.length - 2)))}@${domain}`,
      subscribed,
    };
  });
}

/** Failed deliveries in the last 7 days (shown on the admin page). */
export async function failedCount(actor: Actor): Promise<number> {
  const universityId = uni(actor);
  assertCan(actor, "settings.manage", { universityId });
  return withTenant(actor, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifDeliveries)
      .where(and(eq(notifDeliveries.status, "failed"), gte(notifDeliveries.createdAt, new Date(Date.now() - 7 * 86_400_000))));
    return r?.n ?? 0;
  });
}
