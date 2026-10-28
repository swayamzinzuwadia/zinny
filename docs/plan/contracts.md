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

`npm run gen` scans `src/modules/*/index.ts` and writes `src/generated/registry.ts`. It runs automatically before `dev`, `build` and `test`. Nobody edits a shared list by hand, so modules never conflict.

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
await emit(tx, actor, "lesson.completed", { userId, courseId, lessonId });

// src/modules/<module>/events.ts
export const handlers: EventHandler[] = [
  { id: "gamification.award-xp", on: ["lesson.completed", "test.submitted"], handle: async ({ tx, actor, event }) => { … } },
];
```

Handlers run inside `withTenant` for the event's university, as that university's system actor. Tests call `drainEvents()` from `tests/helpers/events.ts` to deliver everything synchronously.

### Event catalogue (frozen)

| Event | Emitted by | Payload |
|---|---|---|
| `user.invited` | core (add person, CSV import), zinny-team-panel | `{ userId, email, name, role }` |
| `enrolment.confirmed` | core | `{ enrolmentId, userId, courseId, batchId }` |
| `enrolment.switched` | core | `{ enrolmentId, userId, courseId, fromBatchId, toBatchId }` |
| `enrolment.ended` | core (graduation, cancel) | `{ enrolmentId, userId, courseId, reason }` |
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
| `enquiry.received` | website-builder | `{ enquiryId, name, email, phone }` |

`payment.confirmed` and `enrolment.ended` have no consumer in this wave; they exist for later modules.

Course completion: content-progress decides when a course is complete and calls core `markEnrolmentCompleted`, which emits `enrolment.completed`. Certificates listen to `enrolment.completed`.

## 3. Slots (where module UI appears inside core pages)

Core pages render whatever the registry provides, ordered by `order`, and only for people who pass the slot's `action` check. Each slot gets `{ uni, actor, … }` and is a server component.

| Slot | Shows up on | Keys and order reserved per module |
|---|---|---|
| `adminCourseTabs` | Admin course page tabs (core keeps Batches and Settings) | `curriculum` 100 content-progress · `live` 200 live-classes · `assignments` 300 assignments-polls · `polls` 310 assignments-polls · `tests` 400 assessments · `certificates` 500 certificates |
| `adminBatchSections` | Admin batch page, under the timetable | `attendance` 200 live-classes · `assignments` 300 assignments-polls · `tests` 400 assessments |
| `learnerCourseTabs` | `/[uni]/learn/my/[enrolmentId]` (course hub, built by foundation-lock) | `lessons` 100 · `live` 200 · `assignments` 300 · `tests` 400 · `certificate` 500 · `leaderboard` 600 |
| `learnerHubSections` | `/[uni]/learn/my` below the course list | `assignment-grades` 300 · `test-results` 400 · `certificates` 500 · `xp` 600 |
| `learnerHomeCards` | Learner home, below "Today" | `continue-learning` 100 · `join-next` 200 · `due-soon` 300 · `upcoming-tests` 400 · `xp` 600 |
| `dashboardCards` | Admin dashboard, below "Seats by batch" | `attendance-today` 200 · `to-grade-assignments` 300 · `to-grade-tests` 400 · `certificates-issued` 500 · `top-learners` 600 |

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

`/api/jobs/run?every=day` (cron, `CRON_SECRET`) runs each job once per university as that university's system actor, under row-level security.

## 6. Seeds

`npm run db:seed` runs the core seed (Demo University, people, courses, batches, enrolments), then each module's `seed(ctx)`. `ctx` gives the demo university id, `actorFor(email)` and the core seed's ids by name. Module seeds may only write their own tables (or go through the core API).

## 7. Storage, email and SMS

```ts
import { storage, sendEmail, sendSms } from "@/server/core";
await storage().put({ key: `${universityId}/assignments/${id}/${fileName}`, body, contentType });
const url = await storage().signedUrl(key, 600);
await sendEmail({ to, subject, html, text });
await sendSms({ to, text });
```

- Storage keys must start with `<universityId>/<module>/`. Dev writes to `./.storage`; production uses any S3-compatible bucket (Cloudflare R2) via env.
- `sendEmail` and `sendSms` print to the console until notifications-delivery registers real transports. Everyone else just calls them.
- `gateway()` returns the mock payment gateway until payments registers Razorpay through `paymentGateway`. The `PaymentGateway` interface (`createOrder`, `verifyPayment`, `verifyWebhook`, plus `refund`) lives in `src/contracts/payments.ts`. Core's seat hold calls `gateway().createOrder`, so it never imports the payments module.

## 8. Core API — `@/server/core`

Stable functions every module may use. Nothing else from `src/server/**` is public.

```ts
// Tenancy, permissions, audit, events
withTenant, audit, emit, systemActorFor
assertCan, can, reach, hasRole                         // types Actor, Target, Action
// Context
universityLite(tx) → { id, slug, name, timezone, legalName, gstin, branding }
todayFor(tx) → "YYYY-MM-DD" in the university's time zone
peopleLite(tx, userIds) → { id, name, email }[]
// Courses and batches
getCourseLite(tx, courseId) → { id, title, departmentId, programId, status, certificateEnabled, pricePaise }
courseTarget(tx, universityId, courseId) → Target
batchLite(tx, batchId) → { id, courseId, departmentId, name, startDate, endDate, seatLimit, status, meetingUrl, target }
listCourseBatches(tx, courseId) → batchLite[]
facultyBatchIds(actor) → string[]
// Students
batchStudentIds(tx, batchId) → string[]                 // active enrolments
studentEnrolments(tx, userId) → { enrolmentId, courseId, batchId, status }[]
enrolmentById(tx, enrolmentId)
markEnrolmentCompleted(actor, enrolmentId)              // emits enrolment.completed
// Calendar
scheduledBatches(tx, batchIds), expandSessions(batches, from, to), studentTimetable(actor, range?)
// Messages and files
notify(tx, universityId, userIds, { kind, title, body, data }), hodsOf(tx, departmentId)
storage(), sendEmail(), sendSms(), gateway()
// Money (payments uses these; nobody else writes orders)
orderForCheckout(actor, orderId)                         // the student's own order, course, batch, hold expiry
confirmPayment(universityId, { orderId, gatewayPaymentId }) // enrols, issues the GST invoice, emits payment.confirmed
failPayment(universityId, orderId)
markOrderRefunded(actor, orderId, gatewayRefundId)     // needs finance.refund
orderUniversity(gatewayOrderId) → universityId | null   // for webhooks, which arrive without a tenant
// Zinny team (platform context, no university)
listUniversities, createUniversity, updateUniversity, enterSupportMode, exitSupportMode, supportTrail,
grantPlatformRole, revokePlatformRole, assertPlatform, canPlatform
```

## 9. Permissions

All actions for every module are registered up front in `src/server/authz/roles.ts` by foundation-lock. Use exactly these names. Faculty powers always come from batch assignments (scope = batch).

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
| gamification | uses existing `leaderboard.manage`, `leaderboard.view` | as in PRD page 3 |
| | `self.view_xp` | student |
| website-builder | uses existing `website.manage` | Admin |
| notifications-delivery | uses existing `settings.manage`; `self.profile` for preferences | every university role |
| identity | `self.profile`, uses `user.manage_roles` for resending invites | |
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
