/**
 * assessments tables. Prefix: assess_. drizzle.config.ts picks this file up automatically.
 * Every table has `university_id`, so row-level security applies to all of them.
 *
 *   assess_questions        the question pool: one per department, plus a university-wide pool (department_id null)
 *   assess_tests            quizzes, mock tests and test series (kind = "series"), with proctoring and settings
 *   assess_test_batches     specific batches a test targets (when all_batches is false)
 *   assess_test_questions   questions picked from the pool for a test, in order
 *   assess_draw_rules       "8 random medium questions tagged SQL", drawn fresh for every attempt
 *   assess_attempts         one row per student attempt; the server's end time lives here
 *   assess_attempt_items    the attempt's paper: a snapshot of each question, the response and its marks
 *   assess_proctor_events   tab switches and full-screen exits, recorded on the server
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { batches, courses, departments, universities, users } from "@/db/schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const marks = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });

/* ───────────────────────────── Enums ───────────────────────────── */

export const assessQuestionType = pgEnum("assess_question_type", ["single", "multiple", "true_false", "numeric", "short"]);
export const assessDifficulty = pgEnum("assess_difficulty", ["easy", "medium", "hard"]);
export const assessTestKind = pgEnum("assess_test_kind", ["quiz", "mock_test", "series"]);
export const assessTestStatus = pgEnum("assess_test_status", ["draft", "published"]);
export const assessShowAnswers = pgEnum("assess_show_answers", ["never", "after_submit", "after_close"]);
export const assessAttemptStatus = pgEnum("assess_attempt_status", ["in_progress", "awaiting_grading", "graded"]);
export const assessSubmitReason = pgEnum("assess_submit_reason", ["student", "time_up", "tab_limit"]);
export const assessProctorKind = pgEnum("assess_proctor_kind", ["tab_hidden", "fullscreen_exit"]);

export type QuestionType = (typeof assessQuestionType.enumValues)[number];
export type Difficulty = (typeof assessDifficulty.enumValues)[number];
export type TestKind = (typeof assessTestKind.enumValues)[number];
export type ShowAnswers = (typeof assessShowAnswers.enumValues)[number];
export type AttemptStatus = (typeof assessAttemptStatus.enumValues)[number];
export type SubmitReason = (typeof assessSubmitReason.enumValues)[number];
export type ProctorKind = (typeof assessProctorKind.enumValues)[number];

/** A choice shown to the student. Ids are short and random, so they say nothing about correctness. */
export type QuestionOption = { id: string; text: string };

/**
 * The correct answer. Never leaves the server before the student may see it.
 *   single, true_false: { option }    multiple: { options }    numeric: { value, tolerance }
 *   short: { guide } (a model answer or rubric for whoever grades it)
 */
export type QuestionAnswer =
  | { option: string }
  | { options: string[] }
  | { value: number; tolerance: number }
  | { guide: string };

/** What a student sent. single, true_false: { option }; multiple: { options }; numeric: { value }; short: { text }. */
export type QuestionResponse = { option: string } | { options: string[] } | { value: number } | { text: string };

/* ───────────────────────────── Question pool ───────────────────────────── */

export const assessQuestions = pgTable(
  "assess_questions",
  {
    id: id(),
    universityId: universityId(),
    /** The department's pool; null = the university-wide pool (written by admins only). */
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
    type: assessQuestionType("type").notNull(),
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<QuestionOption[]>().notNull().default([]),
    answer: jsonb("answer").$type<QuestionAnswer>().notNull(),
    marks: marks("marks").notNull().default(1),
    negativeMarks: marks("negative_marks").notNull().default(0),
    difficulty: assessDifficulty("difficulty").notNull().default("medium"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    explanation: text("explanation").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Archived questions leave the pool; attempts keep their own snapshot. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    check("assess_questions_marks", sql`${t.marks} > 0`),
    check("assess_questions_negative", sql`${t.negativeMarks} >= 0`),
    index("assess_questions_pool_idx").on(t.universityId, t.departmentId),
  ],
);

/* ───────────────────────────── Tests and series ───────────────────────────── */

export const assessTests = pgTable(
  "assess_tests",
  {
    id: id(),
    universityId: universityId(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** Copied from the course, so department-scoped checks need no join. */
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    kind: assessTestKind("kind").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    /** true = every batch of the course (now and later); false = the batches in assess_test_batches. */
    allBatches: boolean("all_batches").notNull().default(true),

    // Proctoring
    timeLimitMinutes: integer("time_limit_minutes"),
    fullscreenRequired: boolean("fullscreen_required").notNull().default(false),
    /** How many times a student may leave the test (switch tab or app). One more submits it. Null = no limit. */
    tabSwitchLimit: integer("tab_switch_limit"),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    shuffleOptions: boolean("shuffle_options").notNull().default(false),
    onePerPage: boolean("one_per_page").notNull().default(false),
    attemptLimit: integer("attempt_limit").notNull().default(1),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),

    // Settings
    passPercent: integer("pass_percent").notNull().default(40),
    showAnswers: assessShowAnswers("show_answers").notNull().default("after_submit"),
    status: assessTestStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /** The series this test belongs to (a test is in at most one series), and its place in it. */
    seriesId: uuid("series_id").references((): AnyPgColumn => assessTests.id, { onDelete: "set null" }),
    seriesPosition: integer("series_position").notNull().default(0),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("assess_tests_attempt_limit", sql`${t.attemptLimit} between 1 and 50`),
    check("assess_tests_time_limit", sql`${t.timeLimitMinutes} is null or ${t.timeLimitMinutes} between 1 and 1440`),
    check("assess_tests_tab_limit", sql`${t.tabSwitchLimit} is null or ${t.tabSwitchLimit} between 0 and 50`),
    check("assess_tests_pass", sql`${t.passPercent} between 0 and 100`),
    check("assess_tests_window", sql`${t.opensAt} is null or ${t.closesAt} is null or ${t.closesAt} > ${t.opensAt}`),
    check("assess_tests_series_not_nested", sql`${t.kind} <> 'series' or ${t.seriesId} is null`),
    index("assess_tests_course_idx").on(t.courseId),
    index("assess_tests_dept_idx").on(t.departmentId),
    index("assess_tests_series_idx").on(t.seriesId),
  ],
);

export const assessTestBatches = pgTable(
  "assess_test_batches",
  {
    universityId: universityId(),
    testId: uuid("test_id")
      .notNull()
      .references(() => assessTests.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.testId, t.batchId] }), index("assess_test_batches_batch_idx").on(t.batchId)],
);

export const assessTestQuestions = pgTable(
  "assess_test_questions",
  {
    universityId: universityId(),
    testId: uuid("test_id")
      .notNull()
      .references(() => assessTests.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => assessQuestions.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.testId, t.questionId] })],
);

export const assessDrawRules = pgTable(
  "assess_draw_rules",
  {
    id: id(),
    universityId: universityId(),
    testId: uuid("test_id")
      .notNull()
      .references(() => assessTests.id, { onDelete: "cascade" }),
    count: integer("count").notNull(),
    /** The pool to draw from: a department's pool, or null for the university-wide pool. */
    poolDepartmentId: uuid("pool_department_id").references(() => departments.id, { onDelete: "cascade" }),
    difficulty: assessDifficulty("difficulty"),
    type: assessQuestionType("type"),
    tag: text("tag"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    check("assess_draw_rules_count", sql`${t.count} between 1 and 200`),
    index("assess_draw_rules_test_idx").on(t.testId),
  ],
);

/* ───────────────────────────── Attempts ───────────────────────────── */

export const assessAttempts = pgTable(
  "assess_attempts",
  {
    id: id(),
    universityId: universityId(),
    testId: uuid("test_id")
      .notNull()
      .references(() => assessTests.id, { onDelete: "no action" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    /** The batch the student was in when they started: who may see and grade the attempt. */
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    status: assessAttemptStatus("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** The server's end time. Answers after it are refused, and the attempt is submitted. Null = no time limit. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submitReason: assessSubmitReason("submit_reason"),
    /** Marks so far (objective only while short answers wait), then the final score. Can be below 0 with negative marking. */
    score: marks("score"),
    maxScore: marks("max_score").notNull().default(0),
    /** Final score as 0–100, set once nothing is left to grade. */
    scorePercent: numeric("score_percent", { precision: 5, scale: 2, mode: "number" }),
    passed: boolean("passed"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    tabSwitches: integer("tab_switches").notNull().default(0),
    fullscreenExits: integer("fullscreen_exits").notNull().default(0),
  },
  (t) => [
    // The attempt limit holds even with two tabs: the second insert of the same number fails.
    uniqueIndex("assess_attempts_no_uq").on(t.testId, t.userId, t.attemptNo),
    uniqueIndex("assess_attempts_one_open_uq").on(t.testId, t.userId).where(sql`${t.status} = 'in_progress'`),
    index("assess_attempts_test_idx").on(t.testId),
    index("assess_attempts_user_idx").on(t.userId),
    index("assess_attempts_open_idx").on(t.status, t.endsAt),
  ],
);

export const assessAttemptItems = pgTable(
  "assess_attempt_items",
  {
    id: id(),
    universityId: universityId(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => assessAttempts.id, { onDelete: "cascade" }),
    /** The pool question this was drawn from (for % correct per question). */
    questionId: uuid("question_id").references(() => assessQuestions.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    // Snapshot, so later edits to the pool never change an attempt.
    type: assessQuestionType("type").notNull(),
    prompt: text("prompt").notNull(),
    /** In the order this student sees them. */
    options: jsonb("options").$type<QuestionOption[]>().notNull().default([]),
    answer: jsonb("answer").$type<QuestionAnswer>().notNull(),
    explanation: text("explanation").notNull().default(""),
    marks: marks("marks").notNull(),
    negativeMarks: marks("negative_marks").notNull().default(0),
    // The student's work
    response: jsonb("response").$type<QuestionResponse>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    // Marking
    autoScore: marks("auto_score"),
    manualScore: marks("manual_score"),
    correct: boolean("correct"),
    needsGrading: boolean("needs_grading").notNull().default(false),
    feedback: text("feedback").notNull().default(""),
    gradedBy: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("assess_attempt_items_pos_uq").on(t.attemptId, t.position),
    index("assess_attempt_items_question_idx").on(t.questionId),
    index("assess_attempt_items_grading_idx").on(t.attemptId).where(sql`${t.needsGrading}`),
  ],
);

export const assessProctorEvents = pgTable(
  "assess_proctor_events",
  {
    id: id(),
    universityId: universityId(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => assessAttempts.id, { onDelete: "cascade" }),
    kind: assessProctorKind("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assess_proctor_events_attempt_idx").on(t.attemptId)],
);
