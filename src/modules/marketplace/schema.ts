/**
 * marketplace tables. Prefix: mkt_. drizzle.config.ts picks this file up automatically.
 * Money is integer paise.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { batches, courses, orders, universities, users } from "@/db/schema";
import { contentLessons } from "@/modules/content-progress/schema";

export type ListingKind = "course" | "lecture" | "combo";
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
    /** Before GST. The usual price, shown struck through next to `pricePaise`. */
    compareAtPaise: integer("compare_at_paise"),
    status: text("status").$type<ListingStatus>().notNull().default("live"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mkt_listings_course_uq").on(t.courseId),
    index("mkt_listings_status_idx").on(t.status, t.createdAt),
    check("mkt_listing_kind", sql`${t.kind} in ('course', 'lecture', 'combo')`),
    check("mkt_listing_status", sql`${t.status} in ('live', 'paused')`),
    check("mkt_listing_price", sql`${t.pricePaise} > 0`),
    check("mkt_listing_compare_at", sql`${t.compareAtPaise} is null or ${t.compareAtPaise} > ${t.pricePaise}`),
  ],
);

/** The courses a combo was made from, in order. The combo's own course holds copies of their lessons. */
export const mktComboCourses = pgTable(
  "mkt_combo_courses",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => mktListings.id, { onDelete: "cascade" }),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.courseId] })],
);

export type CodeKind = "percent" | "amount";
export type CodeStatus = "active" | "paused";

/**
 * A discount code an institute hands out. `value` is a percentage (1 to 90) or paise off the
 * price before GST. No `listingId` means it works on everything the institute sells.
 * Dates are YYYY-MM-DD in the institute's time zone, both ends included.
 */
export const mktCodes = pgTable(
  "mkt_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: text("kind").$type<CodeKind>().notNull(),
    value: integer("value").notNull(),
    listingId: uuid("listing_id").references(() => mktListings.id, { onDelete: "cascade" }),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    maxUses: integer("max_uses"),
    status: text("status").$type<CodeStatus>().notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mkt_codes_code_uq").on(t.universityId, t.code),
    check("mkt_code_kind", sql`${t.kind} in ('percent', 'amount')`),
    check("mkt_code_status", sql`${t.status} in ('active', 'paused')`),
    check("mkt_code_value", sql`${t.value} > 0 and (${t.kind} <> 'percent' or ${t.value} <= 90)`),
    check("mkt_code_uses", sql`${t.maxUses} is null or ${t.maxUses} > 0`),
  ],
);

/** A code used on an order. It counts towards the code's limit while the order is pending or paid. */
export const mktRedemptions = pgTable(
  "mkt_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    codeId: uuid("code_id")
      .notNull()
      .references(() => mktCodes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    discountPaise: integer("discount_paise").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mkt_redemptions_order_uq").on(t.orderId), index("mkt_redemptions_code_idx").on(t.codeId)],
);
