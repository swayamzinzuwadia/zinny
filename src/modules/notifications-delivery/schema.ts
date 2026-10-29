/**
 * notifications-delivery tables. Prefix: notif_. drizzle.config.ts picks this file up automatically.
 * Every table has `university_id`, so row-level security applies to all of them (`npm run db:push`).
 *
 *   notif_university_settings  one row per university: where delivery starts, reply-to address
 *   notif_kind_settings        per kind: channel defaults and template text (missing row = catalogue defaults)
 *   notif_preferences          per person, kind and channel: on or off (missing row = the admin default)
 *   notif_suppressions         unsubscribes for email addresses that don't belong to a person here
 *   notif_dispatches           one row per core notification the delivery job has already planned
 *   notif_deliveries           every message: one row per notification and channel, plus direct and test sends
 */
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { notifications, universities, users } from "@/db/schema";

const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const notifChannel = pgEnum("notif_channel", ["email", "sms", "whatsapp"]);
/** off = never sent; optional = off unless the person turns it on; on = on unless the person turns it off. */
export const notifChannelState = pgEnum("notif_channel_state", ["off", "optional", "on"]);
export const notifDeliveryStatus = pgEnum("notif_delivery_status", ["queued", "sending", "sent", "failed", "skipped"]);
/** notification = planned from a core notification; direct = another module called sendEmail/sendSms; test = an admin's test send. */
export const notifSource = pgEnum("notif_source", ["notification", "direct", "test"]);

export type Channel = (typeof notifChannel.enumValues)[number];
export type ChannelState = (typeof notifChannelState.enumValues)[number];
export type DeliveryStatus = (typeof notifDeliveryStatus.enumValues)[number];

export const notifUniversitySettings = pgTable("notif_university_settings", {
  universityId: universityId().primaryKey(),
  /** Core notifications created before this moment are never delivered (so turning delivery on doesn't send old news). */
  deliverFrom: ts("deliver_from").notNull().defaultNow(),
  /** Replies to notification emails go here. Null = no reply-to header. */
  replyTo: text("reply_to"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const notifKindSettings = pgTable(
  "notif_kind_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    kind: text("kind").notNull(),
    email: notifChannelState("email").notNull(),
    sms: notifChannelState("sms").notNull(),
    whatsapp: notifChannelState("whatsapp").notNull(),
    /** Null = the catalogue's default text. Variables like {{title}} are filled in when sending. */
    emailSubject: text("email_subject"),
    emailBody: text("email_body"),
    smsText: text("sms_text"),
    /** MSG91 template id for this kind (MSG91 links it to the DLT-registered template). */
    smsTemplateId: text("sms_template_id"),
    /** Approved WhatsApp template name in MSG91. */
    whatsappTemplate: text("whatsapp_template"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notif_kind_settings_kind_uq").on(t.universityId, t.kind)],
);

export const notifPreferences = pgTable(
  "notif_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    channel: notifChannel("channel").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notif_preferences_uq").on(t.universityId, t.userId, t.kind, t.channel)],
);

export const notifSuppressions = pgTable(
  "notif_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    /** Lower-cased email address. */
    address: text("address").notNull(),
    kind: text("kind").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notif_suppressions_uq").on(t.universityId, t.address, t.kind)],
);

export const notifDispatches = pgTable(
  "notif_dispatches",
  {
    notificationId: uuid("notification_id")
      .primaryKey()
      .references(() => notifications.id, { onDelete: "cascade" }),
    universityId: universityId(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("notif_dispatches_created_idx").on(t.universityId, t.createdAt)],
);

/** What was (or will be) sent. Security messages never store their text: it holds codes and reset links. */
export type DeliveryPayload = {
  subject?: string;
  html?: string;
  text?: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  /** SMS / WhatsApp template variables. */
  vars?: Record<string, string>;
  redacted?: boolean;
};

export const notifDeliveries = pgTable(
  "notif_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    source: notifSource("source").notNull(),
    notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    channel: notifChannel("channel").notNull(),
    /** Sign-in codes, password resets, invitations: no quiet hours, no unsubscribe, text never stored. */
    security: boolean("security").notNull().default(false),
    /** Email address or phone number in E.164. Null when the person has none (status skipped). */
    recipient: text("recipient"),
    status: notifDeliveryStatus("status").notNull(),
    /** Why a delivery was skipped or why it last failed, in words an admin can act on. */
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    /**
     * Attempts the provider is known to have refused. Part of the email idempotency key, so a
     * send whose outcome is unknown (interrupted) repeats with the same key and Resend drops it
     * if the first one went through, while a known failure is retried with a fresh key.
     */
    failures: integer("failures").notNull().default(0),
    /** A send was interrupted and its outcome is unknown: never offered for a manual retry, so it can't arrive twice. */
    interrupted: boolean("interrupted").notNull().default(false),
    nextAttemptAt: ts("next_attempt_at"),
    /** While status = sending: when this claim expires (a crashed run). */
    lockedUntil: ts("locked_until"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    payload: jsonb("payload").$type<DeliveryPayload>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    // Never the same notification on the same channel twice (direct and test sends have no notification).
    uniqueIndex("notif_deliveries_notification_channel_uq").on(t.notificationId, t.channel),
    index("notif_deliveries_due_idx").on(t.status, t.nextAttemptAt).where(sql`${t.status} in ('queued', 'sending')`),
    index("notif_deliveries_recent_idx").on(t.universityId, t.createdAt),
  ],
);
