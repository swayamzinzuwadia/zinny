/**
 * website-builder tables. Prefix: site_. drizzle.config.ts picks this file up automatically.
 * Every table holds university data, so each has `university_id uuid not null` referencing
 * universities; row-level security is applied to it by `npm run db:push`.
 *
 * What is live and what is a draft:
 *  - The home page (site_pages) has a draft and a published copy of its sections.
 *    Only `published` reaches the public site; publishing copies the draft over it.
 *  - Blog posts have a status; only published posts are public.
 *  - Faculty profiles have a draft (what the faculty member wrote) and a published copy
 *    (what an admin approved). Only `published` is public, and only while `visible`.
 *  - Reviews are public only once approved. Testimonials, team, gallery and videos are
 *    public while `visible`. Enquiries and reviewer emails are never public.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses, universities, users } from "@/db/schema";
import type { PageSection } from "./sections";

const id = () => uuid("id").primaryKey().defaultRandom();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const siteReviewStatus = pgEnum("site_review_status", ["pending", "approved", "hidden"]);
export const sitePostStatus = pgEnum("site_post_status", ["draft", "published"]);
export const siteEnquiryStatus = pgEnum("site_enquiry_status", ["new", "contacted", "closed"]);
export const siteProfileStatus = pgEnum("site_profile_status", ["draft", "pending", "approved", "changes_requested"]);

export type MediaKind = "logo" | "cover" | "hero" | "gallery" | "post" | "team" | "testimonial" | "faculty";

/** Every uploaded image. Files live in storage() under `<universityId>/website-builder/media/<id>.webp`. */
export const siteMedia = pgTable("site_media", {
  id: id(),
  universityId: universityId(),
  key: text("key").notNull(),
  kind: text("kind").$type<MediaKind>().notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  alt: text("alt").notNull().default(""),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("site_media_uni_idx").on(t.universityId, t.createdAt)]);

export type SocialLinks = Partial<Record<"website" | "facebook" | "instagram" | "linkedin" | "youtube" | "x", string>>;

/** The institute profile: one row per university. Live as soon as it is saved. */
export const siteProfiles = pgTable("site_profiles", {
  id: id(),
  universityId: universityId(),
  tagline: text("tagline").notNull().default(""),
  about: text("about").notNull().default(""),
  foundedYear: smallint("founded_year"),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  mapUrl: text("map_url").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  whatsapp: text("whatsapp").notNull().default(""),
  social: jsonb("social").$type<SocialLinks>().notNull().default({}),
  /** The site's main colour. Null = the university's branding colour, else Zinny green. */
  primaryColor: text("primary_color"),
  logoMediaId: uuid("logo_media_id").references(() => siteMedia.id, { onDelete: "set null" }),
  coverMediaId: uuid("cover_media_id").references(() => siteMedia.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("site_profiles_uni_uq").on(t.universityId)]);

/** The home page: ordered sections, as a draft and as published. */
export const sitePages = pgTable("site_pages", {
  id: id(),
  universityId: universityId(),
  draft: jsonb("draft").$type<PageSection[]>().notNull(),
  published: jsonb("published").$type<PageSection[] | null>(),
  draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).notNull().defaultNow(),
  draftUpdatedBy: uuid("draft_updated_by").references(() => users.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("site_pages_uni_uq").on(t.universityId)]);

export const siteTestimonials = pgTable("site_testimonials", {
  id: id(),
  universityId: universityId(),
  name: text("name").notNull(),
  /** "Data Analytics, class of 2025" */
  byline: text("byline").notNull().default(""),
  quote: text("quote").notNull(),
  photoMediaId: uuid("photo_media_id").references(() => siteMedia.id, { onDelete: "set null" }),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("site_testimonials_uni_idx").on(t.universityId, t.position)]);

export const siteTeam = pgTable("site_team", {
  id: id(),
  universityId: universityId(),
  name: text("name").notNull(),
  /** "Registrar" */
  title: text("title").notNull().default(""),
  bio: text("bio").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  photoMediaId: uuid("photo_media_id").references(() => siteMedia.id, { onDelete: "set null" }),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("site_team_uni_idx").on(t.universityId, t.position)]);

/** Reviews sent from the public site (or added by an admin). Public only once approved. */
export const siteReviews = pgTable("site_reviews", {
  id: id(),
  universityId: universityId(),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  /** Never shown on the public site. */
  authorEmail: text("author_email").notNull().default(""),
  rating: smallint("rating").notNull(),
  body: text("body").notNull(),
  status: siteReviewStatus("status").notNull().default("pending"),
  moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  check("site_review_rating", sql`${t.rating} between 1 and 5`),
  index("site_reviews_uni_status_idx").on(t.universityId, t.status, t.createdAt),
]);

export const siteGallery = pgTable("site_gallery", {
  id: id(),
  universityId: universityId(),
  mediaId: uuid("media_id")
    .notNull()
    .references(() => siteMedia.id, { onDelete: "cascade" }),
  caption: text("caption").notNull().default(""),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("site_gallery_uni_idx").on(t.universityId, t.position)]);

export const siteVideos = pgTable("site_videos", {
  id: id(),
  universityId: universityId(),
  title: text("title").notNull(),
  youtubeId: text("youtube_id").notNull(),
  description: text("description").notNull().default(""),
  visible: boolean("visible").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  check("site_video_id", sql`${t.youtubeId} ~ '^[A-Za-z0-9_-]{11}$'`),
  index("site_videos_uni_idx").on(t.universityId, t.position),
]);

export const sitePosts = pgTable("site_posts", {
  id: id(),
  universityId: universityId(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  /** Sanitised on every save (see sanitize.ts). */
  bodyHtml: text("body_html").notNull().default(""),
  coverMediaId: uuid("cover_media_id").references(() => siteMedia.id, { onDelete: "set null" }),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  status: sitePostStatus("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("site_posts_slug_uq").on(t.universityId, t.slug),
  index("site_posts_uni_status_idx").on(t.universityId, t.status, t.publishedAt),
]);

export const siteEnquiries = pgTable("site_enquiries", {
  id: id(),
  universityId: universityId(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message").notNull().default(""),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
  /** Where the form was: "home" or "course". */
  source: text("source").notNull().default("home"),
  status: siteEnquiryStatus("status").notNull().default("new"),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("site_enquiries_uni_status_idx").on(t.universityId, t.status, t.createdAt)]);

/** The enquiry's history: notes, status changes and assignments, oldest first. */
export const siteEnquiryNotes = pgTable("site_enquiry_notes", {
  id: id(),
  universityId: universityId(),
  enquiryId: uuid("enquiry_id")
    .notNull()
    .references(() => siteEnquiries.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"note" | "status" | "assignee">().notNull().default("note"),
  body: text("body").notNull(),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("site_enquiry_notes_enquiry_idx").on(t.enquiryId, t.createdAt)]);

export type FacultyProfileContent = {
  headline: string;
  bio: string;
  subjects: string[];
  photoMediaId: string | null;
};

/** "My profile page": a teaching staff member's public profile. They write it; an admin approves it. */
export const siteFacultyProfiles = pgTable("site_faculty_profiles", {
  id: id(),
  universityId: universityId(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  draft: jsonb("draft").$type<FacultyProfileContent>().notNull(),
  published: jsonb("published").$type<FacultyProfileContent | null>(),
  status: siteProfileStatus("status").notNull().default("draft"),
  /** Shown to the faculty member when an admin sends the profile back. */
  reviewNote: text("review_note").notNull().default(""),
  /** An admin can take an approved profile off the site without deleting it. */
  visible: boolean("visible").notNull().default(true),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("site_faculty_profiles_user_uq").on(t.universityId, t.userId)]);

/** Public form submissions, for rate limiting. `fingerprint` is an HMAC of the sender's IP, never the IP itself. */
export const siteSubmissions = pgTable("site_submissions", {
  id: id(),
  universityId: universityId(),
  kind: text("kind").$type<"enquiry" | "review">().notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: createdAt(),
}, (t) => [index("site_submissions_lookup_idx").on(t.universityId, t.kind, t.fingerprint, t.createdAt)]);
