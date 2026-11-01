/**
 * marketplace tables. Prefix: mkt_. drizzle.config.ts picks this file up automatically.
 * Money is integer paise.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { batches, courses, universities, users } from "@/db/schema";
import { contentLessons } from "@/modules/content-progress/schema";

export type ListingKind = "course" | "lecture";
export type ListingStatus = "live" | "paused";

/**
 * People who signed up on their own, for the marketplace. They belong to no institute, so
 * this table has no university_id and only the system connection can read it (policies.sql).
 */
export const mktLearners = pgTable("mkt_learners", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One recorded course or single lecture an institute sells. What buyers get is `course`,
 * in its hidden recorded `batch`; a lecture is a one-lesson course of its own (see
 * listings.ts), so progress, invoices and refunds work the same for both.
 */
export const mktListings = pgTable(
  "mkt_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ListingKind>().notNull(),
    /** The lesson a lecture was listed from, so it isn't offered for listing twice. */
    sourceLessonId: uuid("source_lesson_id").references(() => contentLessons.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Before GST. Separate from the course price, which institute students pay. */
    pricePaise: integer("price_paise").notNull(),
    status: text("status").$type<ListingStatus>().notNull().default("live"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mkt_listings_course_uq").on(t.courseId),
    index("mkt_listings_status_idx").on(t.status, t.createdAt),
    check("mkt_listing_kind", sql`${t.kind} in ('course', 'lecture')`),
    check("mkt_listing_status", sql`${t.status} in ('live', 'paused')`),
    check("mkt_listing_price", sql`${t.pricePaise} > 0`),
  ],
);
