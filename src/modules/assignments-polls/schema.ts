/**
 * assignments-polls tables. Prefix: asgn_ and poll_. drizzle.config.ts picks this file up automatically.
 * Every table has `university_id`, so row-level security applies to it on `npm run db:push`.
 *
 * Deadlines and poll windows are instants (timestamptz). Staff enter them as a date and a
 * time of day in the university's time zone; the service converts them (lib/time.ts).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { batches, courses, departments, universities, users } from "@/db/schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Marks with up to two decimals (7.5 of 10), read as numbers. */
const marks = (name: string) => numeric(name, { precision: 7, scale: 2, mode: "number" });

/* ───────────────────────────── Assignments ───────────────────────────── */

export const asgnSubmissionType = pgEnum("asgn_submission_type", ["text", "files", "both"]);
export const asgnFilePurpose = pgEnum("asgn_file_purpose", ["attachment", "submission", "returned"]);

export const asgnAssignments = pgTable(
  "asgn_assignments",
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
    title: text("title").notNull(),
    /** Sanitised HTML (lib/sanitize.ts). */
    instructionsHtml: text("instructions_html").notNull().default(""),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    points: integer("points").notNull(),
    allowLate: boolean("allow_late").notNull().default(false),
    /** Taken off the marks of late work, 0–100. */
    latePenaltyPct: smallint("late_penalty_pct").notNull().default(0),
    submissionType: asgnSubmissionType("submission_type").notNull().default("both"),
    maxFiles: smallint("max_files").notNull().default(3),
    maxFileMb: smallint("max_file_mb").notNull().default(10),
    /** True: every batch of the course, including batches added later. False: the rows in asgn_assignment_batches. */
    allBatches: boolean("all_batches").notNull().default(false),
    /** Set when the day-before reminder went out; cleared when the due date moves. */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("asgn_points_range", sql`${t.points} between 1 and 1000`),
    check("asgn_penalty_range", sql`${t.latePenaltyPct} between 0 and 100`),
    check("asgn_max_files_range", sql`${t.maxFiles} between 1 and 10`),
    check("asgn_max_file_mb_range", sql`${t.maxFileMb} between 1 and 50`),
    index("asgn_assignments_course_idx").on(t.courseId),
    index("asgn_assignments_due_idx").on(t.universityId, t.dueAt),
  ],
);

/** The batches an assignment is for, when it isn't for the whole course. */
export const asgnAssignmentBatches = pgTable(
  "asgn_assignment_batches",
  {
    universityId: universityId(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => asgnAssignments.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.batchId] }), index("asgn_assignment_batches_batch_idx").on(t.batchId)],
);

/**
 * One row per student per assignment: where their work stands and its grade.
 * Each hand-in is a row in asgn_submission_versions, so history is kept. A row with no
 * versions is a grade given without online work (handed in on paper, or a zero).
 */
export const asgnSubmissions = pgTable(
  "asgn_submissions",
  {
    id: id(),
    universityId: universityId(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => asgnAssignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The student's batch: who grades it. Follows the student when they switch batch. */
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    versionCount: integer("version_count").notNull().default(0),
    /** The latest version came in after the due date. */
    late: boolean("late").notNull().default(false),
    /** Marks as given by the grader, before any late penalty. */
    marks: marks("marks"),
    penaltyPct: smallint("penalty_pct"),
    finalMarks: marks("final_marks"),
    scorePercent: numeric("score_percent", { precision: 5, scale: 2, mode: "number" }),
    feedback: text("feedback"),
    gradedBy: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("asgn_submissions_one_per_student").on(t.assignmentId, t.userId),
    index("asgn_submissions_batch_idx").on(t.assignmentId, t.batchId),
    index("asgn_submissions_user_idx").on(t.userId),
    index("asgn_submissions_to_grade_idx").on(t.universityId, t.batchId).where(sql`${t.submittedAt} is not null and ${t.gradedAt} is null`),
  ],
);

export const asgnSubmissionVersions = pgTable(
  "asgn_submission_versions",
  {
    id: id(),
    universityId: universityId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => asgnSubmissions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Plain text, shown with line breaks kept. */
    textAnswer: text("text_answer").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    late: boolean("late").notNull().default(false),
  },
  (t) => [uniqueIndex("asgn_versions_number_uq").on(t.submissionId, t.version)],
);

/**
 * Every stored file: assignment attachments, submitted files and files returned with a
 * grade. A file is uploaded first ("staged": attached_at is null), in one or more parts,
 * and then claimed by the form that uses it. Staged files nobody claims are removed by the
 * daily job. When a student keeps a file in a new version, the new row points at the same
 * stored object, so storage keys repeat only within one submission.
 */
export const asgnFiles = pgTable(
  "asgn_files",
  {
    id: id(),
    universityId: universityId(),
    purpose: asgnFilePurpose("purpose").notNull(),
    assignmentId: uuid("assignment_id").references(() => asgnAssignments.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => asgnSubmissions.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => asgnSubmissionVersions.id, { onDelete: "cascade" }),
    /** Always `<universityId>/assignments-polls/files/<id>/<name>`. */
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when every part arrived and the whole file is in storage. */
    storedAt: timestamp("stored_at", { withTimezone: true }),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("asgn_files_key_idx").on(t.storageKey),
    check("asgn_files_key_prefix", sql`${t.storageKey} like (${t.universityId}::text || '/assignments-polls/%')`),
    index("asgn_files_assignment_idx").on(t.assignmentId),
    index("asgn_files_submission_idx").on(t.submissionId),
    index("asgn_files_version_idx").on(t.versionId),
    index("asgn_files_staged_idx").on(t.universityId, t.createdAt).where(sql`${t.attachedAt} is null`),
  ],
);

/* ───────────────────────────── Polls ───────────────────────────── */

export const pollPolls = pgTable(
  "poll_polls",
  {
    id: id(),
    universityId: universityId(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    /** Null: every batch of the course. */
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** Votes are stored without the voter (poll_voters only records that they voted). */
    anonymous: boolean("anonymous").notNull().default(false),
    /** Students see the results once the poll has closed. */
    resultsToStudents: boolean("results_to_students").notNull().default(true),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    /** Set when students were told the poll is open. */
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("poll_window", sql`${t.closesAt} > ${t.opensAt}`),
    index("poll_polls_course_idx").on(t.courseId),
    index("poll_polls_batch_idx").on(t.batchId),
  ],
);

export const pollOptions = pgTable(
  "poll_options",
  {
    id: id(),
    universityId: universityId(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => pollPolls.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [index("poll_options_poll_idx").on(t.pollId)],
);

/** One ballot per voter. `user_id` is null on anonymous polls; no timestamp, so ballots can't be matched to voters by time. */
export const pollVotes = pgTable(
  "poll_votes",
  {
    id: id(),
    universityId: universityId(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => pollPolls.id, { onDelete: "cascade" }),
    optionId: uuid("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("poll_votes_poll_idx").on(t.pollId), uniqueIndex("poll_votes_one_named").on(t.pollId, t.userId).where(sql`${t.userId} is not null`)],
);

/** Who has voted. The primary key is what makes "vote once" hold, even under races. */
export const pollVoters = pgTable(
  "poll_voters",
  {
    universityId: universityId(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => pollPolls.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.userId] })],
);
