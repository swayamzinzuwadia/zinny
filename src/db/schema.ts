/**
 * Zinny — Phase 1 data model.
 *
 * Rules that shape this file (PRD page 9):
 *  - Every tenant table carries `university_id`. Row-level security (policies.sql)
 *    makes rows from other universities invisible to the app's database role.
 *  - Permissions are stored as user + role + scope (role_assignments).
 *  - Money is stored in paise (integers), never floats.
 *  - Times of day are stored in the university's own time zone.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  date,
  time,
  jsonb,
  uniqueIndex,
  index,
  check,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

/* ───────────────────────────── Enums ───────────────────────────── */

export const roleName = pgEnum("role_name", [
  // Zinny team (platform scope)
  "super_admin",
  "account_manager",
  "content_qa",
  "finance_admin",
  "partnerships",
  "support_agent",
  // University — administration
  "institute_admin",
  "board_owner",
  "accounts_fees",
  // University — teaching
  "hod",
  "permanent_faculty",
  "visiting_faculty",
  // University — students
  "student",
  "alumni",
  "parent",
  // Marketplace (phase 3)
  "independent_instructor",
  "sponsor",
  "corporate_partner",
  "individual_learner",
]);

export const scopeType = pgEnum("scope_type", ["platform", "university", "department", "batch"]);
export const courseStatus = pgEnum("course_status", ["draft", "published", "archived"]);
export const batchStatus = pgEnum("batch_status", ["draft", "open", "closed", "archived"]);
export const enrolmentStatus = pgEnum("enrolment_status", [
  "held", // seat held while the student pays (10 minutes)
  "active",
  "completed",
  "cancelled",
  "expired", // hold ran out before payment
  "ended", // program course removed when the student became alumni
]);
export const switchStatus = pgEnum("switch_status", ["pending", "approved", "rejected", "cancelled"]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "failed",
  "expired",
  "refund_due", // paid after the hold expired and the batch had filled
  "refunded",
]);
export const overrideKind = pgEnum("override_kind", ["cancelled", "rescheduled", "extra"]);

/* ─────────────────────────── Platform ─────────────────────────── */

export const universities = pgTable("universities", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  /** GST details for invoices. */
  gstin: text("gstin"),
  stateCode: text("state_code").notNull().default("27"), // 27 = Maharashtra
  legalName: text("legal_name"),
  address: text("address"),
  /** Up to 4 characters, so invoice numbers stay within GST's 16-character limit. */
  invoicePrefix: text("invoice_prefix").notNull().default("ZN"),
  branding: jsonb("branding").$type<{ primaryColor?: string; logoUrl?: string }>().notNull().default({}),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [check("invoice_prefix_len", sql`char_length(${t.invoicePrefix}) between 1 and 4`)]);

/** One identity per person across Zinny. What they can see is decided by role_assignments. */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Zinny team entering a university's space. Always time-boxed and logged. */
export const supportSessions = pgTable("support_sessions", {
  id: id(),
  staffUserId: uuid("staff_user_id").notNull().references(() => users.id),
  universityId: universityId(),
  reason: text("reason").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

/* ─────────────────────── Structure of a university ─────────────────────── */

export const departments = pgTable("departments", {
  id: id(),
  universityId: universityId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("departments_code_uq").on(t.universityId, t.code)]);

export const programs = pgTable("programs", {
  id: id(),
  universityId: universityId(),
  departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/* ─────────────────────── Courses and batches ─────────────────────── */

export const batches = pgTable("batches", {
  id: id(),
  universityId: universityId(),
  courseId: uuid("course_id").notNull().references((): AnyPgColumn => courses.id, { onDelete: "cascade" }),
  /** Copied from the course so department-scoped checks need no join. */
  departmentId: uuid("department_id").notNull().references(() => departments.id),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  seatLimit: integer("seat_limit").notNull(),
  status: batchStatus("status").notNull().default("open"),
  meetingUrl: text("meeting_url"),
  createdAt: createdAt(),
}, (t) => [
  check("batch_dates", sql`${t.endDate} >= ${t.startDate}`),
  check("batch_seats", sql`${t.seatLimit} > 0`),
  index("batches_course_idx").on(t.courseId),
]);

/**
 * The single source of truth for "who can do what, where".
 * Exactly one scope column is set, matching scope_type.
 */
export const roleAssignments = pgTable("role_assignments", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleName("role").notNull(),
  scopeType: scopeType("scope_type").notNull(),
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  /** Visiting faculty lose access at this moment. */
  endsAt: timestamp("ends_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  check(
    "scope_shape",
    sql`(${t.scopeType} = 'platform'   and ${t.universityId} is null     and ${t.departmentId} is null     and ${t.batchId} is null)
     or (${t.scopeType} = 'university' and ${t.universityId} is not null and ${t.departmentId} is null     and ${t.batchId} is null)
     or (${t.scopeType} = 'department' and ${t.universityId} is not null and ${t.departmentId} is not null and ${t.batchId} is null)
     or (${t.scopeType} = 'batch'      and ${t.universityId} is not null and ${t.departmentId} is null     and ${t.batchId} is not null)`,
  ),
  index("role_assignments_user_idx").on(t.userId),
  index("role_assignments_uni_idx").on(t.universityId),
  index("role_assignments_batch_idx").on(t.batchId),
]);

export const courses = pgTable("courses", {
  id: id(),
  universityId: universityId(),
  departmentId: uuid("department_id").notNull().references(() => departments.id),
  programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  pricePaise: integer("price_paise").notNull().default(0),
  /** Basis points: 1800 = 18%. */
  gstRateBp: integer("gst_rate_bp").notNull().default(1800),
  certificateEnabled: boolean("certificate_enabled").notNull().default(true),
  status: courseStatus("status").notNull().default("draft"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [check("course_price", sql`${t.pricePaise} >= 0`), index("courses_dept_idx").on(t.departmentId)]);

/** Weekly timings. weekday is ISO: 1 = Monday … 7 = Sunday. Times are in the university's time zone. */
export const batchSlots = pgTable("batch_slots", {
  id: id(),
  universityId: universityId(),
  batchId: uuid("batch_id").notNull().references(() => batches.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
}, (t) => [
  check("slot_weekday", sql`${t.weekday} between 1 and 7`),
  check("slot_times", sql`${t.endTime} > ${t.startTime}`),
  index("batch_slots_batch_idx").on(t.batchId),
]);

/** One-off changes to a batch's calendar: a holiday, a moved class, an extra class. */
export const sessionOverrides = pgTable("session_overrides", {
  id: id(),
  universityId: universityId(),
  batchId: uuid("batch_id").notNull().references(() => batches.id, { onDelete: "cascade" }),
  /** The date that is affected. */
  date: date("date").notNull(),
  kind: overrideKind("kind").notNull(),
  /** For rescheduled and extra classes. */
  newDate: date("new_date"),
  startTime: time("start_time"),
  endTime: time("end_time"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

/* ─────────────────────── Students ─────────────────────── */

export const enrolments = pgTable("enrolments", {
  id: id(),
  universityId: universityId(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  status: enrolmentStatus("status").notNull(),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("enrolments_batch_idx").on(t.batchId, t.status),
  index("enrolments_user_idx").on(t.userId),
  // A student holds at most one live seat per course.
  uniqueIndex("enrolments_one_live_per_course")
    .on(t.userId, t.courseId)
    .where(sql`${t.status} in ('held', 'active')`),
]);

export const batchSwitchRequests = pgTable("batch_switch_requests", {
  id: id(),
  universityId: universityId(),
  enrolmentId: uuid("enrolment_id").notNull().references(() => enrolments.id, { onDelete: "cascade" }),
  fromBatchId: uuid("from_batch_id").notNull().references(() => batches.id),
  toBatchId: uuid("to_batch_id").notNull().references(() => batches.id),
  reason: text("reason"),
  status: switchStatus("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("switch_one_pending").on(t.enrolmentId).where(sql`${t.status} = 'pending'`),
]);

export const parentLinks = pgTable("parent_links", {
  universityId: universityId(),
  parentUserId: uuid("parent_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studentUserId: uuid("student_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.universityId, t.parentUserId, t.studentUserId] })]);

/* ─────────────────────── Money ─────────────────────── */

export const orders = pgTable("orders", {
  id: id(),
  universityId: universityId(),
  userId: uuid("user_id").notNull().references(() => users.id),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  enrolmentId: uuid("enrolment_id").references(() => enrolments.id),
  basePaise: integer("base_paise").notNull(),
  gstPaise: integer("gst_paise").notNull(),
  totalPaise: integer("total_paise").notNull(),
  status: orderStatus("status").notNull().default("pending"),
  gateway: text("gateway").notNull().default("mock"),
  gatewayOrderId: text("gateway_order_id"),
  gatewayPaymentId: text("gateway_payment_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [check("order_total", sql`${t.totalPaise} = ${t.basePaise} + ${t.gstPaise}`)]);

export const invoiceCounters = pgTable("invoice_counters", {
  universityId: universityId(),
  financialYear: text("financial_year").notNull(), // e.g. "26-27"
  lastSeq: integer("last_seq").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.universityId, t.financialYear] })]);

export const invoices = pgTable("invoices", {
  id: id(),
  universityId: universityId(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  number: text("number").notNull(),
  financialYear: text("financial_year").notNull(),
  sellerGstin: text("seller_gstin"),
  sellerName: text("seller_name").notNull(),
  buyerName: text("buyer_name").notNull(),
  buyerEmail: text("buyer_email").notNull(),
  placeOfSupply: text("place_of_supply").notNull(),
  description: text("description").notNull(),
  basePaise: integer("base_paise").notNull(),
  cgstPaise: integer("cgst_paise").notNull().default(0),
  sgstPaise: integer("sgst_paise").notNull().default(0),
  igstPaise: integer("igst_paise").notNull().default(0),
  totalPaise: integer("total_paise").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invoices_number_uq").on(t.universityId, t.number),
  check("invoice_number_len", sql`char_length(${t.number}) <= 16`),
]);

/* ─────────────────────── Logs and notifications ─────────────────────── */

/** Append-only. The app's database role can insert and read, never update or delete. */
export const auditLog = pgTable("audit_log", {
  id: id(),
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  supportSessionId: uuid("support_session_id").references(() => supportSessions.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data").notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_uni_at_idx").on(t.universityId, t.at)]);

export const notifications = pgTable("notifications", {
  id: id(),
  universityId: universityId(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  data: jsonb("data").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);

/* ─────────────────────── Events (contracts.md section 2) ─────────────────────── */

/**
 * Transactional outbox: written in the same transaction as the change that caused it.
 * Append-only for the app. university_id is null only for Zinny team (platform) events.
 */
export const domainEvents = pgTable("domain_events", {
  id: id(),
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("domain_events_type_at_idx").on(t.type, t.occurredAt),
  index("domain_events_uni_at_idx").on(t.universityId, t.occurredAt),
]);

/**
 * One row per (event, handler): attempts, the last error and when it was delivered.
 * university_id is copied from the event so the record is written in the same
 * tenant transaction as the handler's own work.
 */
export const domainEventDeliveries = pgTable("domain_event_deliveries", {
  eventId: uuid("event_id").notNull().references(() => domainEvents.id, { onDelete: "cascade" }),
  handlerId: text("handler_id").notNull(),
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "cascade" }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
}, (t) => [uniqueIndex("domain_event_deliveries_uq").on(t.eventId, t.handlerId)]);

export type RoleName = (typeof roleName.enumValues)[number];
export type ScopeType = (typeof scopeType.enumValues)[number];
