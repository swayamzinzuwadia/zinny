/**
 * content-progress tables. Prefix: content_. drizzle.config.ts picks this file up automatically.
 * content_sections and content_lessons were moved from core by foundation-lock (they were
 * course_sections and lessons); this module added the lesson settings and the progress tables.
 * Row-level security applies automatically because each table has university_id.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses, enrolments, universities, users } from "@/db/schema";
import type { LessonContent, LessonKind, DripMode, WatchedRange } from "./lib/kinds";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const contentSections = pgTable("content_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("content_sections_course_idx").on(t.courseId)]);

/**
 * One lesson. `content` depends on `kind` (see lib/kinds.ts):
 *   video  { source: "upload", key, fileName, contentType, size } | { source: "youtube" | "vimeo", videoId, url }
 *   pdf    { key, fileName, size }
 *   text   { html }            sanitised when saved and again when shown
 *   link   { url }
 *   live   {}                  points to the batch's live classes
 * Drip: "none" (open from enrolment), "after_start" (drip_days after the student's batch
 * starts) or "on_date" (drip_date).
 */
export const contentLessons = pgTable("content_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => contentSections.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").$type<LessonKind>().notNull().default("video"),
  content: jsonb("content").$type<LessonContent>().notNull().default({}),
  position: integer("position").notNull().default(0),
  /**
   * True once the lesson has its content (a live lesson always has). Only ready lessons
   * are shown to students and count toward progress. Kept in step with `content` by the service.
   */
  ready: boolean("ready").notNull().default(false),
  required: boolean("required").notNull().default(true),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  dripMode: text("drip_mode").$type<DripMode>().notNull().default("none"),
  dripDays: integer("drip_days"),
  dripDate: date("drip_date"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("content_lessons_section_idx").on(t.sectionId),
  index("content_lessons_course_idx").on(t.courseId, t.required, t.ready),
  check("content_lesson_kind", sql`${t.kind} in ('video', 'pdf', 'text', 'link', 'live')`),
  check("content_lesson_duration", sql`${t.durationMinutes} >= 0 and ${t.durationMinutes} <= 6000`),
  check(
    "content_lesson_drip",
    sql`(${t.dripMode} = 'none' and ${t.dripDays} is null and ${t.dripDate} is null)
     or (${t.dripMode} = 'after_start' and ${t.dripDays} is not null and ${t.dripDays} >= 0 and ${t.dripDate} is null)
     or (${t.dripMode} = 'on_date' and ${t.dripDays} is null and ${t.dripDate} is not null)`,
  ),
]);

/**
 * A learner's progress on one lesson. Videos keep the parts already watched (merged
 * second ranges), so progress adds up across sittings and skipping ahead doesn't count.
 */
export const contentLessonProgress = pgTable("content_lesson_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").notNull().references(() => contentLessons.id, { onDelete: "cascade" }),
  /** 0–100. For videos, the share watched; 100 once completed. */
  percent: integer("percent").notNull().default(0),
  watchedRanges: jsonb("watched_ranges").$type<WatchedRange[]>().notNull().default([]),
  mediaSeconds: integer("media_seconds"),
  positionSeconds: integer("position_seconds").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** "manual" (Mark complete) or "video" (90% watched). */
  completedVia: text("completed_via"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("content_lesson_progress_uq").on(t.lessonId, t.userId),
  index("content_lesson_progress_user_course_idx").on(t.userId, t.courseId),
  check("content_lesson_progress_percent", sql`${t.percent} between 0 and 100`),
]);

/**
 * A learner's progress on a course, one row per enrolment. percent = completed required
 * lessons ÷ required lessons (0 when the course has no required lessons). The row is
 * locked while a lesson is completed, so concurrent completions are counted correctly.
 * completed_at mirrors the enrolment's completion (automatic at 100% or marked by staff).
 */
export const contentCourseProgress = pgTable("content_course_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  enrolmentId: uuid("enrolment_id").notNull().references(() => enrolments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  percent: integer("percent").notNull().default(0),
  completedRequired: integer("completed_required").notNull().default(0),
  totalRequired: integer("total_required").notNull().default(0),
  lastLessonId: uuid("last_lesson_id").references(() => contentLessons.id, { onDelete: "set null" }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("content_course_progress_enrolment_uq").on(t.enrolmentId),
  index("content_course_progress_course_idx").on(t.courseId),
  index("content_course_progress_user_idx").on(t.userId),
  check("content_course_progress_percent", sql`${t.percent} between 0 and 100`),
]);

/**
 * A file upload in progress (video or PDF for one lesson). Files arrive in parts of at
 * most 4 MB, so every request stays under serverless body limits; the parts are stored
 * under uploads/<id>/ and joined into the lesson's file when the last one arrives.
 * Rows left behind by abandoned uploads are cleaned up (with their parts) by a daily job.
 */
export const contentUploads = pgTable("content_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").notNull().references(() => contentLessons.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"video" | "pdf">().notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  partSize: integer("part_size").notNull(),
  partCount: integer("part_count").notNull(),
  receivedParts: integer("received_parts").array().notNull().default(sql`'{}'::integer[]`),
  /** Seconds, measured by the editor's browser when the file was picked (videos only). */
  durationSeconds: integer("duration_seconds"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("content_uploads_lesson_idx").on(t.lessonId),
  index("content_uploads_created_idx").on(t.createdAt),
  check("content_upload_kind", sql`${t.kind} in ('video', 'pdf')`),
  check("content_upload_size", sql`${t.size} > 0 and ${t.partSize} > 0 and ${t.partCount} > 0`),
]);
