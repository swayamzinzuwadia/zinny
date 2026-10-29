/**
 * Shared reads for one university, inside an open withTenant transaction. No permission
 * checks here: the service and delivery functions that call these check first.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { roleAssignments, users } from "@/db/schema";
import { kindDefinition, type ChannelDefaults, type KindDefinition, type KindTemplate } from "./kinds";
import { notifKindSettings, notifPreferences, notifSuppressions, notifUniversitySettings, type Channel, type ChannelState } from "./schema";

export type KindConfig = {
  def: KindDefinition;
  /** The admin's channel states (the catalogue's defaults when nothing is saved). */
  channels: ChannelDefaults;
  template: KindTemplate;
  customized: { emailSubject: boolean; emailBody: boolean; smsText: boolean };
  smsTemplateId: string | null;
  whatsappTemplate: string | null;
  /** True when the university saved settings for this kind. */
  saved: boolean;
  updatedAt: Date | null;
};

type KindRow = typeof notifKindSettings.$inferSelect;

export function configFrom(def: KindDefinition, row?: KindRow | null): KindConfig {
  return {
    def,
    channels: row ? { email: row.email, sms: row.sms, whatsapp: row.whatsapp } : { ...def.defaults },
    template: {
      emailSubject: row?.emailSubject ?? def.template.emailSubject,
      emailBody: row?.emailBody ?? def.template.emailBody,
      smsText: row?.smsText ?? def.template.smsText,
    },
    customized: { emailSubject: row?.emailSubject != null, emailBody: row?.emailBody != null, smsText: row?.smsText != null },
    smsTemplateId: row?.smsTemplateId ?? null,
    whatsappTemplate: row?.whatsappTemplate ?? null,
    saved: !!row,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function kindConfigs(tx: Tx, kinds: readonly string[]): Promise<Map<string, KindConfig>> {
  const unique = [...new Set(kinds)];
  const out = new Map<string, KindConfig>();
  if (unique.length === 0) return out;
  const rows = await tx.select().from(notifKindSettings).where(inArray(notifKindSettings.kind, unique));
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  for (const k of unique) out.set(k, configFrom(kindDefinition(k), byKind.get(k)));
  return out;
}

/** Whether a channel is on for a person: the admin's state, then the person's own choice. */
export function channelAllowed(state: ChannelState, preference: boolean | undefined): boolean {
  if (state === "off") return false;
  if (state === "on") return preference !== false;
  return preference === true;
}

export const prefKey = (userId: string, kind: string, channel: Channel) => `${userId}|${kind}|${channel}`;

export async function preferenceMap(tx: Tx, userIds: readonly string[], kinds?: readonly string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(notifPreferences)
    .where(and(inArray(notifPreferences.userId, ids), kinds ? inArray(notifPreferences.kind, [...new Set(kinds)]) : undefined));
  return new Map(rows.map((r) => [prefKey(r.userId, r.kind, r.channel), r.enabled]));
}

export async function isSuppressed(tx: Tx, address: string, kind: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: notifSuppressions.id })
    .from(notifSuppressions)
    .where(and(eq(notifSuppressions.address, address.toLowerCase()), eq(notifSuppressions.kind, kind)))
    .limit(1);
  return !!row;
}

export type Recipient = { id: string; name: string; email: string; phone: string | null; learner: boolean };

const LEARNER_ROLES = ["student", "alumni", "parent", "individual_learner"] as const;

/** People visible in this university, with whether they use the learner app (for the settings link). */
export async function recipients(tx: Tx, universityId: string, userIds: readonly string[]): Promise<Map<string, Recipient>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const people = await tx.select({ id: users.id, name: users.name, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, ids));
  const learners = await tx
    .selectDistinct({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .where(
      and(
        inArray(roleAssignments.userId, ids),
        eq(roleAssignments.universityId, universityId),
        isNull(roleAssignments.revokedAt),
        inArray(roleAssignments.role, [...LEARNER_ROLES]),
      ),
    );
  const learnerIds = new Set(learners.map((l) => l.userId));
  return new Map(people.map((p) => [p.id, { ...p, learner: learnerIds.has(p.id) }]));
}

/** The person in this university with this email address, if any. */
export async function personByEmail(tx: Tx, universityId: string, email: string): Promise<Recipient | null> {
  const [p] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!p) return null;
  return (await recipients(tx, universityId, [p.id])).get(p.id) ?? null;
}

export type UniversityDeliverySettings = { deliverFrom: Date; replyTo: string | null; saved: boolean };

/** How far back a new university's delivery starts, so the first run doesn't send old news. */
export const FIRST_RUN_LOOKBACK_MS = 15 * 60_000;

export async function readUniversitySettings(tx: Tx, now: Date): Promise<UniversityDeliverySettings> {
  const [row] = await tx.select().from(notifUniversitySettings).limit(1);
  if (row) return { deliverFrom: row.deliverFrom, replyTo: row.replyTo, saved: true };
  return { deliverFrom: new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS), replyTo: null, saved: false };
}

/** The settings row, created on the first delivery run for a university. */
export async function ensureUniversitySettings(tx: Tx, universityId: string, now: Date): Promise<UniversityDeliverySettings> {
  const current = await readUniversitySettings(tx, now);
  if (current.saved) return current;
  await tx
    .insert(notifUniversitySettings)
    .values({ universityId, deliverFrom: current.deliverFrom, updatedAt: now })
    .onConflictDoNothing();
  return readUniversitySettings(tx, now);
}
