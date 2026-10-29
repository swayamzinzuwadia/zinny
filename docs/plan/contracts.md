# Contracts

These are the only ways modules touch each other. `foundation-lock` builds all of them before any module agent starts, and nobody changes them during a wave. If a contract is missing something you need, write it under "Requests for other owners" in your handoff and work around it inside your own module.

## 1. Module layout

Every module lives in `src/modules/<module>/` and exports one object from `index.ts`:

```ts
// src/contracts/module.ts (frozen)
export type ZinnyModule = {
  id: ModuleId;                                   // e.g. "assessments"
  eventHandlers?: EventHandler[];                 // section 2
  adminCourseTabs?: CourseTab[];                  // section 3
  adminBatchSections?: BatchSection[];
  learnerCourseTabs?: LearnerCourseTab[];
  learnerHubSections?: HubSection[];
  learnerHomeCards?: HomeCard[];
  dashboardCards?: DashboardCard[];
  reports?: ReportDefinition[];                   // section 4
  jobs?: Job[];                                   // section 5
  seed?: (ctx: SeedContext) => Promise<void>;     // section 6
  mailTransport?: MailTransport;                  // section 7 (notifications-delivery only)
  smsTransport?: SmsTransport;                    // section 7 (notifications-delivery only)
  paymentGateway?: PaymentGateway;                // section 7 (payments only)
};
```

`index.ts` **default-exports** the module (`const m: ZinnyModule = { id: "assessments", … }; export default m;`). `npm run gen` scans `src/modules/*/index.ts` and writes `src/generated/registry.ts` (gitignored). It runs automatically before `dev`, `build`, `test`, `typecheck` and `db:seed`. Nobody edits a shared list by hand, so modules never conflict.

Core reads the registry through `@/server/registry`: `slot(name)`, `visibleSlots(name, actor, target)`, `reports()`, `jobs()`, `eventHandlers()`, `seeds()`, `mailTransport()`, `smsTransport()`, `paymentGateway()`. Tests can add a module with `setTestModules([…])`.

The slot, report, job, seed and transport types are in `src/contracts/module.ts`; event types in `src/contracts/events.ts`; the shapes the core API returns in `src/contracts/core.ts`.

Inside your folder, use this layout:

```
src/modules/<module>/
  index.ts        the ZinnyModule export
  schema.ts       your Drizzle tables (prefixed), picked up by drizzle.config.ts automatically
  service.ts      business rules (split into more files as needed)
  actions.ts      "use server" actions that call the service
  events.ts       your event handlers
  reports.ts      your report definitions
  seed.ts         demo data
  components/     UI used only by this module
  ENV.md          environment variables you need
```

## 2. Events

One table, `domain_events`, written in the same transaction as the change that caused it (a transactional outbox). Delivery is at least once per handler, shortly after commit, with a cron job as the safety net. **Handlers must be idempotent**: use `event.id` to avoid doing the work twice.

```ts
import { emit } from "@/server/core";
await emit(tx, actor, "lesson.completed", { userId, courseId, lessonId });   // returns the event id

// src/modules/<module>/events.ts
import { defineHandler, type EventHandler } from "@/contracts/events";
export const handlers: EventHandler[] = [
  defineHandler({ id: "gamification.award-xp", on: ["lesson.completed", "test.submitted"], handle: async ({ tx, actor, event }) => { … } }),
];
```

- `emit` refuses types that aren't in the catalogue. The payload is typed by `EventMap` in `src/contracts/events.ts`; `defineHandler` narrows `event.payload` to the types in `on`.
- Handlers run inside `withTenant` for the event's university, as that university's system actor, inside a savepoint: if `handle` throws, its own writes are rolled back, the failure is recorded, and it is retried later with backoff (30 s doubling, capped at 1 hour), up to 10 attempts. A failing handler never blocks other handlers.
- `event` is `{ id, universityId, type, payload, actorUserId, occurredAt }`. `universityId` is null only for Zinny team events (a team member's `user.invited`); those run with a platform system actor outside any tenant, so handlers that write tenant tables should skip them.
- Handler `id`s must be unique across all modules (`<module>.<name>`); deliveries are recorded per id in `domain_event_deliveries`.
- Delivery happens right after the response that emitted the event, and `GET /api/jobs/events` (cron, every minute) retries anything left. Tests call `drainEvents()` from `tests/helpers/events.ts` to deliver everything synchronously (it ignores the backoff wait); `eventsOfType(type, universityId?)` lists emitted events.

### Event catalogue (frozen)

| Event | Emitted by | Payload |
|---|---|---|
| `user.invited` | core (add person, CSV import, parent link, `createUniversity`, `grantPlatformRole`) — only when the person has no password yet | `{ userId, email, name, role }` |
| `enrolment.confirmed` | core (free enrolment, and paid on `confirmPayment`) | `{ enrolmentId, userId, courseId, batchId }` |
| `enrolment.switched` | core | `{ enrolmentId, userId, courseId, fromBatchId, toBatchId }` |
| `enrolment.ended` | core (graduation; a seat that was only held never emits) | `{ enrolmentId, userId, courseId, reason: "graduated" \| "cancelled" }` |
| `enrolment.completed` | core (`markEnrolmentCompleted`) | `{ enrolmentId, userId, courseId, batchId }` |
| `payment.confirmed` | core | `{ orderId, userId, courseId, batchId, totalPaise, invoiceNumber }` |
| `payment.refunded` | payments | `{ orderId, userId, amountPaise }` |
| `lesson.completed` | content-progress | `{ userId, courseId, lessonId }` |
| `course.progress` | content-progress | `{ userId, courseId, enrolmentId, percent }` |
| `test.submitted` | assessments | `{ attemptId, testId, userId, courseId, batchId, scorePercent, passed }` (`courseId`, `batchId` may be null) |
| `assignment.submitted` | assignments-polls | `{ submissionId, assignmentId, userId, batchId, late }` |
| `assignment.graded` | assignments-polls | `{ submissionId, assignmentId, userId, batchId, scorePercent }` |
| `attendance.marked` | live-classes | `{ batchId, date, startTime, userId, status: "present" \| "late" \| "absent" }` |
| `certificate.issued` | certificates | `{ certificateId, userId, courseId, code }` |
| `xp.awarded` | gamification | `{ userId, points, reason, sourceEventId }` |
| `enquiry.received` | website-builder | `{ enquiryId, name, email, phone }` (`phone` may be null) |

`payment.confirmed` and `enrolment.ended` have no consumer in this wave; they exist for later modules.

Course completion: content-progress decides when a course is complete and calls core `markEnrolmentCompleted`, which emits `enrolment.completed`. Certificates listen to `enrolment.completed`.

## 3. Slots (where module UI appears inside core pages)

Core pages render whatever the registry provides, ordered by `order`, and only for people who pass the slot's `action` check against the page's target. Each entry is `{ key, order, action, component }` (tabs also have a `label`), and `component` is a server component (it may be async and call your own services). Every component gets `{ uni, actor, university }` (`university` is `UniversityLite`) plus the slot's own props below. A component may return `null` to show nothing. If it throws, only its own area shows a short error notice.

| Slot | Extra props | Target the `action` is checked against |
|---|---|---|
| `adminCourseTabs` | `course: CourseLite, target, searchParams` | the course: its department and all its batches. Tab URL: `?tab=<key>` |
| `adminBatchSections` | `batch: BatchLite, course: CourseLite, target` | the batch |
| `learnerCourseTabs` | `enrolment: StudentEnrolment, course, batch, target, searchParams` | the batch, with `ownerUserId` = the learner (so `self.*` actions work). Tab URL: `?tab=<key>` |
| `learnerHubSections` | `enrolments: StudentEnrolment[]` (active and completed) | `{ universityId, ownerUserId }` |
| `learnerHomeCards` | `today` | `{ universityId, ownerUserId }` |
| `dashboardCards` | `today` | shown when the viewer holds `action` in any scope (`reach`); narrow what you show with `reach` |

| Slot | Shows up on | Keys and order reserved per module |
|---|---|---|
| `adminCourseTabs` | Admin course page tabs (core keeps Batches and Settings) | `curriculum` 100 content-progress · `live` 200 live-classes · `assignments` 300 assignments-polls · `polls` 310 assignments-polls · `tests` 400 assessments · `certificates` 500 certificates |
| `adminBatchSections` | Admin batch page, under the timetable | `progress` 100 content-progress (reserved, wave 1 integration) · `attendance` 200 live-classes · `assignments` 300 assignments-polls · `tests` 400 assessments |
| `learnerCourseTabs` | `/[uni]/learn/my/[enrolmentId]` (course hub, built by foundation-lock) | `lessons` 100 · `live` 200 · `assignments` 300 · `tests` 400 · `certificate` 500 · `leaderboard` 600 |
| `learnerHubSections` | `/[uni]/learn/my` below the course list | `assignment-grades` 300 · `test-results` 400 · `certificates` 500 · `xp` 600 · `invoices` 700 payments |
| `learnerHomeCards` | Learner home, below "Today" | `continue-learning` 100 · `join-next` 200 · `due-soon` 300 · `upcoming-tests` 400 · `xp` 600 |
| `dashboardCards` | Admin dashboard, below "Seats by batch" | `attendance-today` 200 · `to-grade-assignments` 300 · `to-grade-tests` 400 · `certificates-issued` 500 · `top-learners` 600 · `refunds-due` 700 payments · `website` 700 website-builder · `my-profile-page` 710 website-builder |

## 4. Reports

The Reports page (owned by reports-board) lists every registered report the viewer may run.

```ts
export type ReportDefinition = {
  id: string;                         // "assessments.test-scores"
  label: string;                      // "Test scores"
  description: string;
  action: Action;                     // permission needed, checked with reach() so scoped viewers see their scope only
  filters: ("dateRange" | "department" | "course" | "batch")[];
  run(actor: Actor, params: ReportParams): Promise<{ columns: { key: string; label: string; type: "text" | "number" | "money" | "date" | "percent" }[]; rows: Record<string, unknown>[] }>;
};
```

Required reports (PRD page 8) and their owners: enrolments and transactions (reports-board, from core tables), course and batch progress (content-progress), test scores (assessments), live class attendance (live-classes).

## 5. Jobs

```ts
export type Job = { id: string; every: "minute" | "hour" | "day"; run(actor: Actor): Promise<void> };
```

`GET /api/jobs/run?every=minute|hour|day` (cron, `Authorization: Bearer $CRON_SECRET`) runs each job of that frequency once per university as that university's system actor, under row-level security. A failing job is logged and doesn't stop the others. Core's own daily job is `core.daily-housekeeping` (seat-hold release, visiting-faculty expiry alerts; formerly `/api/jobs/daily`).

## 6. Seeds

`npm run db:seed` runs the core seed (Demo University, people, courses, batches, enrolments), then each module's `seed(ctx)` in alphabetical order of module id, delivering pending events after each one. **Exception (wave 1 integration):** `gamification` seeds last, because its demo only fills in event types that no other module's seed produced. Module seeds may only write their own tables (or go through the core API).

```ts
type SeedContext = {
  universityId: string; universitySlug: "demo"; today: string;
  actorFor(email: string): Promise<Actor>;     // e.g. actorFor("hema@demo.edu")
  systemActor: Actor;                          // the Demo University's system actor
  ids: {
    departments: Record<string, string>;       // by code: "CS", "MKT"
    courses: Record<string, string>;           // by title: "Python Basics"
    batches: Record<string, string>;           // "Data Analytics / Weekday morning"
    users: Record<string, string>;             // by email, including the Zinny team
    enrolments: Record<string, string>;        // active ones: "riya@demo.edu / Python Basics"
  };
};
```

## 7. Storage, email and SMS

```ts
import { storage, sendEmail, sendSms } from "@/server/core";
await storage().put({ key: `${universityId}/assignments/${id}/${fileName}`, body, contentType });
const url = await storage().signedUrl(key, 600);
await sendEmail({ to, subject, html, text });
await sendSms({ to, text });
```

- `storage()` returns `{ put, get, delete, signedUrl(key, seconds, { downloadName? }) }` (`src/contracts/storage.ts`). Keys must be `<universityId>/<module>/<path>` with plain characters, or `put` throws. Dev writes to `./.storage` and signed URLs are served by `/api/storage/...` with an HMAC signature; production uses any S3-compatible bucket (Cloudflare R2) with `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and optionally `S3_REGION` (default `auto`). Local signatures use `STORAGE_SIGNING_SECRET`.
- `sendEmail({ to, subject, html, text, kind?, universityId?, replyTo? })` and `sendSms({ to, text, kind?, universityId? })` (`src/contracts/mail.ts`, `sms.ts`) print to the console until notifications-delivery registers real transports. Everyone else just calls them. Pass `kind` (e.g. `"security.otp"`) so delivery can pick templates and quiet-hours rules.
- `gateway()` returns the mock payment gateway until payments registers Razorpay through `paymentGateway`. The `PaymentGateway` interface (`name`, `createOrder`, `verifyPayment`, `verifyWebhook`, plus `refund`) lives in `src/contracts/payments.ts`. Core's seat hold calls `gateway().createOrder`, so it never imports the payments module. The Razorpay draft is `src/modules/payments/razorpay.ts`, not registered yet.

## 8. Core API — `@/server/core`

Stable functions every module may use. Nothing else from `src/server/**` is public, except `@/server/registry` for reading other modules' reports (reports-board), `@/server/errors` (`NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError`), `@/server/action` (`attempt`, `str`, `num` for server actions) and `@/server/context` (`spaceContext(uni)`, `platformContext()` for pages). Functions that take `tx` expect a `withTenant` transaction; they don't check permissions, so check first. Lookups of a record outside the tenant throw `NotFoundError`.

```ts
// Tenancy, permissions, audit, events
withTenant, audit, emit, systemActorFor
assertCan, can, reach, hasRole                         // types Actor, Target, Action
// Context
universityLite(tx) → { id, slug, name, timezone, legalName, gstin, branding }   // the tenant's university
todayFor(tx) → "YYYY-MM-DD" in the university's time zone
peopleLite(tx, userIds) → { id, name, email }[]          // in the order asked; people outside the university are left out
// Courses and batches
getCourseLite(tx, courseId) → { id, title, departmentId, programId, status, certificateEnabled, pricePaise }
courseTarget(tx, universityId, courseId) → Target        // the course's department and all its batches
batchLite(tx, batchId) → { id, courseId, departmentId, name, startDate, endDate, seatLimit, status, meetingUrl, target }
listCourseBatches(tx, courseId) → batchLite[]
facultyBatchIds(actor) → string[]                        // batches the actor teaches now (no tx: from the actor's roles)
// Students
batchStudentIds(tx, batchId) → string[]                 // active enrolments
studentEnrolments(tx, userId) → { enrolmentId, courseId, batchId, status }[]   // every status; filter for "active"
enrolmentById(tx, enrolmentId) → { enrolmentId, userId, courseId, batchId, status, enrolledAt }
markEnrolmentCompleted(actor, enrolmentId) → { status: "completed" | "already_completed" }
                                                        // needs enrolment.complete (Admin, HOD, or systemActorFor);
                                                        // emits enrolment.completed once; idempotent, safe under races
// Calendar
scheduledBatches(tx, batchIds), expandSessions(batches, from, to), studentTimetable(actor, range?)
// Messages and files
notify(tx, universityId, userIds, { kind, title, body, data }), hodsOf(tx, departmentId)
storage(), sendEmail(), sendSms(), gateway()
// Money (payments uses these; nobody else writes orders)
orderForCheckout(actor, orderId) → { order, course, batch, enrolment }   // the student's own order only
confirmPayment(universityId, { orderId, gatewayPaymentId }) // enrols, issues the GST invoice, emits payment.confirmed
failPayment(universityId, orderId)
holdSeat(actor, { batchId, acknowledgeClash? }) → { status: "held", orderId } | { status: "enrolled" | "clash", … }
                                                        // added in wave 1 integration (payments seed); the student's own seat hold, as on the course page
markOrderRefunded(actor, orderId, gatewayRefundId) → { status: "refunded" | "already_refunded" }
                                                        // needs finance.refund; paid or refund_due orders only
orderUniversity(gatewayOrderId) → universityId | null   // for webhooks, which arrive without a tenant
// Zinny team (platform context, no university)
listUniversities, createUniversity, updateUniversity, enterSupportMode, exitSupportMode, supportTrail,
grantPlatformRole, revokePlatformRole, assertPlatform, canPlatform
// updateUniversity(actor, universityId, { name, slug, timezone, gstin, legalName, address, stateCode, invoicePrefix, branding, status })
//   needs platform.manage_universities; logged in that university's audit log
// grantPlatformRole(actor, { email, name, role }) / revokePlatformRole(actor, assignmentId): Super Admin only
```

Types: `Actor`, `Target`, `Action`, and `UniversityLite`, `PersonLite`, `CourseLite`, `BatchLite`, `StudentEnrolment`, `EnrolmentLite`, `CheckoutOrder` are exported from `@/server/core` too.

## 9. Permissions

All actions for every module are registered up front in `src/server/authz/roles.ts` by foundation-lock. Use exactly these names. Faculty powers always come from batch assignments (scope = batch). Every `self.*` action needs `ownerUserId: actor.userId` in the target, and passes for any active role in the university that grants it, whatever that role's scope.

| Module | Actions | Granted to |
|---|---|---|
| assessments | `assess.manage`, `assess.grade`, `assess.view_results` | Institute Admin (all), HOD (own dept), faculty (own batches); Board gets `assess.view_results` |
| | `self.take_test` | student, alumni, individual learner |
| live-classes | `live.manage`, `attendance.mark`, `attendance.view` | Admin, HOD, faculty (own batches); Board gets `attendance.view` |
| | `self.join_class` | student |
| assignments-polls | `assignment.manage`, `assignment.grade`, `assignment.view`, `poll.manage` | Admin, HOD, faculty (own batches); Board gets `assignment.view` |
| | `self.submit_assignment`, `self.vote` | student |
| content-progress | `content.manage` | Admin, HOD, faculty (courses of their batches) |
| | `content.view_progress` | Admin, Board, HOD, faculty |
| | `enrolment.complete` | Admin, HOD |
| | `self.learn` | student, alumni, individual learner |
| certificates | `cert.manage`, `cert.issue` | Admin, HOD |
| | `cert.view` | Admin, Board, HOD, faculty |
| | `self.view_certificates` | student, alumni, individual learner |
| payments | `finance.refund` (plus existing `finance.view`, `finance.manage`) | Admin, Accounts & Fees |
| | `self.view_invoices` | student, alumni, individual learner |
| reports-board | uses `finance.view`, `insights.view` and each report's own action | |
| gamification | uses existing `leaderboard.manage`, `leaderboard.view` | as in PRD page 3: Admin; HOD (own dept); permanent faculty view |
| | `self.view_xp` | student |
| website-builder | uses existing `website.manage`; faculty profiles use `self.profile` | Admin |
| notifications-delivery | uses existing `settings.manage`; `self.profile` for preferences | every university role |
| identity | `self.profile`, uses `user.manage_roles` for resending invites | every university role |
| zinny-team-panel | `platform.manage_universities`, `platform.support_mode`, `platform.licences`, `platform.content_review`, `platform.partners`, `platform.finance`, `platform.view_analytics` | Super Admin (all); Account Manager (universities, licences, analytics); Support Agent (support mode, analytics); Content QA (content review); Finance Admin (finance, licences); Partnerships (partners) |

## 10. Table prefixes

| Module | Prefix | Module | Prefix |
|---|---|---|---|
| assessments | `assess_` | reports-board | `rpt_` |
| live-classes | `live_` | gamification | `gam_` |
| assignments-polls | `asgn_`, `poll_` | website-builder | `site_` |
| content-progress | `content_` | notifications-delivery | `notif_` |
| certificates | `cert_` | identity | `idn_` |
| payments | `pay_` | zinny-team-panel | `plat_` |
