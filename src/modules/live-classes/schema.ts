/**
 * live-classes tables. Prefix: live_. drizzle.config.ts picks this file up automatically.
 * Every table has `university_id`, so row-level security applies to it on `npm run db:push`.
 *
 * Class sessions are NOT stored here: they are computed from the timetable (core
 * `scheduledBatches` + `expandSessions`), including cancelled, moved and extra classes.
 * A session is identified by batch + date + start time. These tables keep only what this
 * module adds to a session: its link overrides, when it was started, whether its register
 * is locked, and each student's attendance.
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, pgEnum, pgTable, primaryKey, smallint, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { batches, universities, users } from "@/db/schema";

const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });
const batchId = () =>
  uuid("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" });

export const liveAttendanceStatus = pgEnum("live_attendance_status", ["present", "late", "absent"]);
/** Who set the status: the student joining, a staff member, or the system (no-shows after the class, or at lock). */
export const liveAttendanceSource = pgEnum("live_attendance_source", ["join", "staff", "system"]);

/** What live-classes adds to one class session. Created the first time anything happens to the session. */
export const liveSessions = pgTable(
  "live_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    batchId: batchId(),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    /** Overrides the batch's meeting link for this one class. */
    meetingUrl: text("meeting_url"),
    recordingUrl: text("recording_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    /** When no-shows were marked absent (by the hourly job or at lock). */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("live_sessions_key_uq").on(t.batchId, t.date, t.startTime), index("live_sessions_uni_date_idx").on(t.universityId, t.date)],
);

/** One student's attendance in one session. Joining twice updates the same row. */
export const liveAttendance = pgTable(
  "live_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    batchId: batchId(),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: liveAttendanceStatus("status").notNull(),
    source: liveAttendanceSource("source").notNull(),
    firstJoinedAt: timestamp("first_joined_at", { withTimezone: true }),
    lastJoinedAt: timestamp("last_joined_at", { withTimezone: true }),
    joinCount: integer("join_count").notNull().default(0),
    note: text("note"),
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_attendance_key_uq").on(t.batchId, t.date, t.startTime, t.userId),
    index("live_attendance_user_idx").on(t.userId, t.date),
    index("live_attendance_uni_date_idx").on(t.universityId, t.date),
    check("live_attendance_joins", sql`${t.joinCount} >= 0`),
  ],
);

/** Per-university settings. No row means the defaults (75% threshold). */
export const liveSettings = pgTable(
  "live_settings",
  {
    universityId: uuid("university_id")
      .primaryKey()
      .references(() => universities.id, { onDelete: "cascade" }),
    thresholdPercent: smallint("threshold_percent").notNull().default(75),
    /** Monday of the last week the weekly alerts went out, so they go out once a week. */
    alertsWeek: date("alerts_week"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("live_settings_threshold", sql`${t.thresholdPercent} between 1 and 100`)],
);

/**
 * Weekly low-attendance alerts already sent, so the daily job alerts each person once a
 * week even if it runs twice: one row per student per batch, and per HOD per department.
 */
export const liveAlerts = pgTable(
  "live_alerts",
  {
    universityId: universityId(),
    /** Monday of the week the alert belongs to. */
    week: date("week").notNull(),
    /** "student" (scope = batch id) or "hod" (scope = department id). */
    kind: text("kind").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: uuid("scope").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.universityId, t.week, t.kind, t.userId, t.scope] }),
    check("live_alerts_kind", sql`${t.kind} in ('student', 'hod')`),
  ],
);
