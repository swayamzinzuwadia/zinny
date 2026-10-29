/**
 * gamification tables. Prefix: gam_. drizzle.config.ts picks this file up automatically.
 * Every table carries `university_id`, so row-level security applies to all of them.
 *
 *   gam_settings            how student names show on leaderboards (one row per university)
 *   gam_xp_rules            what earns XP: an event, an optional condition, points and a daily cap
 *   gam_xp_ledger           every XP award; unique per (source event, rule, user)
 *   gam_activity            every learning event we heard about, normalised (badges and challenges count these)
 *   gam_badges              milestones on counts or XP, with a built-in icon
 *   gam_badge_awards        a badge earned by a student, once
 *   gam_challenges          time-bound goals for a batch or a course
 *   gam_challenge_winners   frozen when a challenge ends
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { batches, courses, departments, universities, users } from "@/db/schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

/* ───────────────────────────── Enums ───────────────────────────── */

export const gamNameDisplay = pgEnum("gam_name_display", ["full", "first_initial"]);

/** The events an XP rule can listen to (brief: "Must have" 1). */
export const gamTriggerEvent = pgEnum("gam_trigger_event", [
  "lesson.completed",
  "test.submitted",
  "attendance.marked",
  "assignment.submitted",
  "assignment.graded",
  "enrolment.completed",
]);

/** Optional condition on the event. `min_score` uses `min_score` on the rule. */
export const gamCondition = pgEnum("gam_condition", ["none", "passed", "min_score", "present", "present_or_late", "on_time"]);

/** What badges and challenges measure. */
export const gamMetric = pgEnum("gam_metric", [
  "xp",
  "lessons_completed",
  "tests_passed",
  "classes_attended",
  "attendance_streak_weeks",
  "assignments_on_time",
  "courses_completed",
]);

/** One kind per source event type. */
export const gamActivityKind = pgEnum("gam_activity_kind", [
  "lesson",
  "test",
  "class",
  "assignment_submitted",
  "assignment_graded",
  "course_completed",
]);

export const gamChallengeScope = pgEnum("gam_challenge_scope", ["batch", "course"]);

/* ───────────────────────────── Settings ───────────────────────────── */

export const gamSettings = pgTable("gam_settings", {
  universityId: uuid("university_id")
    .primaryKey()
    .references(() => universities.id, { onDelete: "cascade" }),
  /** How students see each other's names on leaderboards. Staff always see full names. */
  nameDisplay: gamNameDisplay("name_display").notNull().default("first_initial"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────────── XP rules ───────────────────────────── */

export const gamXpRules = pgTable(
  "gam_xp_rules",
  {
    id: id(),
    universityId: universityId(),
    /** Null = the whole university. Otherwise only activity in this department's courses earns XP. */
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eventType: gamTriggerEvent("event_type").notNull(),
    condition: gamCondition("condition").notNull().default("none"),
    /** 1–100, only for condition = min_score. */
    minScore: integer("min_score"),
    points: integer("points").notNull(),
    /** Most awards one student can get from this rule in one day. Null = no cap. */
    dailyCap: integer("daily_cap"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gam_rule_points", sql`${t.points} between 1 and 10000`),
    check("gam_rule_cap", sql`${t.dailyCap} is null or ${t.dailyCap} >= 1`),
    check("gam_rule_min_score", sql`(${t.condition} = 'min_score') = (${t.minScore} is not null)`),
    check("gam_rule_min_score_range", sql`${t.minScore} is null or ${t.minScore} between 1 and 100`),
    index("gam_xp_rules_event_idx").on(t.universityId, t.eventType),
  ],
);

/* ───────────────────────────── Ledger and activity ───────────────────────────── */

export const gamXpLedger = pgTable(
  "gam_xp_ledger",
  {
    id: id(),
    universityId: universityId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Rules are never deleted (only turned off), so the ledger always knows why. */
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => gamXpRules.id),
    /** domain_events.id. No foreign key: the ledger must survive outbox clean-ups. */
    sourceEventId: uuid("source_event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** The thing that earned it ("lesson:<id>", "class:<batch>|<date>|<time>"), so each earns once per rule. */
    dedupeKey: text("dedupe_key").notNull(),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    /** The student's current batch in that course; follows enrolment.switched. */
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    /** The day it counts for, in the university's time zone (the class date for attendance). */
    awardDate: date("award_date").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("gam_xp_ledger_event_rule_user_uq").on(t.sourceEventId, t.ruleId, t.userId),
    uniqueIndex("gam_xp_ledger_rule_user_subject_uq").on(t.ruleId, t.userId, t.dedupeKey),
    index("gam_xp_ledger_user_idx").on(t.universityId, t.userId, t.awardDate),
    index("gam_xp_ledger_cap_idx").on(t.ruleId, t.userId, t.awardDate),
    index("gam_xp_ledger_batch_idx").on(t.batchId, t.awardDate),
    index("gam_xp_ledger_course_idx").on(t.courseId, t.awardDate),
    index("gam_xp_ledger_dept_idx").on(t.departmentId, t.awardDate),
    check("gam_ledger_points", sql`${t.points} > 0`),
  ],
);

export const gamActivity = pgTable(
  "gam_activity",
  {
    id: id(),
    universityId: universityId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceEventId: uuid("source_event_id").notNull(),
    kind: gamActivityKind("kind").notNull(),
    /** What the activity was about: a lesson, test, class session, assignment or enrolment. */
    subjectKey: text("subject_key").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    activityDate: date("activity_date").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    scorePercent: doublePrecision("score_percent"),
    passed: boolean("passed"),
    /** Attendance: present, late or absent. */
    status: text("status"),
    late: boolean("late"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("gam_activity_event_user_uq").on(t.sourceEventId, t.userId),
    index("gam_activity_user_idx").on(t.universityId, t.userId, t.kind),
    index("gam_activity_batch_idx").on(t.batchId, t.kind, t.activityDate),
    index("gam_activity_course_idx").on(t.courseId, t.kind, t.activityDate),
  ],
);

/* ───────────────────────────── Badges ───────────────────────────── */

export const gamBadges = pgTable(
  "gam_badges",
  {
    id: id(),
    universityId: universityId(),
    /** Null = the whole university. Otherwise only this department's activity counts. */
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** One of the built-in icons (catalog.ts BADGE_ICONS). */
    icon: text("icon").notNull(),
    metric: gamMetric("metric").notNull(),
    threshold: integer("threshold").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("gam_badge_threshold", sql`${t.threshold} between 1 and 1000000`), index("gam_badges_uni_idx").on(t.universityId)],
);

export const gamBadgeAwards = pgTable(
  "gam_badge_awards",
  {
    id: id(),
    universityId: universityId(),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => gamBadges.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The metric's value when it was earned. */
    value: integer("value").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gam_badge_awards_uq").on(t.badgeId, t.userId), index("gam_badge_awards_user_idx").on(t.universityId, t.userId)],
);

/* ───────────────────────────── Challenges ───────────────────────────── */

export const gamChallenges = pgTable(
  "gam_challenges",
  {
    id: id(),
    universityId: universityId(),
    /** Copied from the course so department-scoped checks need no join. */
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    scope: gamChallengeScope("scope").notNull(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** Set when scope = batch. */
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    metric: gamMetric("metric").notNull(),
    target: integer("target").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Set when winners were frozen after the end date. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    check("gam_challenge_dates", sql`${t.endDate} >= ${t.startDate}`),
    check("gam_challenge_target", sql`${t.target} between 1 and 1000000`),
    check("gam_challenge_scope_shape", sql`(${t.scope} = 'batch') = (${t.batchId} is not null)`),
    index("gam_challenges_uni_idx").on(t.universityId, t.endDate),
  ],
);

export const gamChallengeWinners = pgTable(
  "gam_challenge_winners",
  {
    universityId: universityId(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => gamChallenges.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 1 = first to reach the target. */
    position: integer("position").notNull(),
    value: integer("value").notNull(),
    reachedAt: timestamp("reached_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.challengeId, t.userId] })],
);

export type XpRule = typeof gamXpRules.$inferSelect;
export type Badge = typeof gamBadges.$inferSelect;
export type Challenge = typeof gamChallenges.$inferSelect;
export type Metric = (typeof gamMetric.enumValues)[number];
export type Condition = (typeof gamCondition.enumValues)[number];
export type TriggerEvent = (typeof gamTriggerEvent.enumValues)[number];
export type ActivityKind = (typeof gamActivityKind.enumValues)[number];
export type NameDisplay = (typeof gamNameDisplay.enumValues)[number];
