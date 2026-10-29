/**
 * content-progress tables. Prefix: content_. drizzle.config.ts picks this file up automatically.
 * Moved from core by foundation-lock (they were course_sections and lessons).
 * Row-level security applies automatically because each table has university_id.
 */
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { courses, universities } from "@/db/schema";

export const contentSections = pgTable("content_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [index("content_sections_course_idx").on(t.courseId)]);

export const contentLessons = pgTable("content_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  universityId: uuid("university_id").notNull().references(() => universities.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => contentSections.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("video"), // video | text | pdf | live
  content: jsonb("content").notNull().default({}),
  position: integer("position").notNull().default(0),
}, (t) => [index("content_lessons_section_idx").on(t.sectionId)]);
