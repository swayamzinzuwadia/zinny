# Zinny performance and code-health review

Reviewed at commit b2d71f6, on Next.js 16.4 (Turbopack), React 19, Drizzle and Postgres 16 with row-level security (RLS).

## Summary

Zinny is in good shape for its size. Module tables were already indexed with care, and the heavy pages (admin dashboard, platform analytics, institute list) already fetch their data in parallel. The main gap was the **core tables** (`orders`, `enrolments`, `batches`, `courses`, `audit_log` and a few more). They are the ones every tenant writes to and reads from, and they had indexes on only some foreign keys.

This pass made safe changes only:

- **19 indexes** added: 14 on core tables, 5 on module tables. They help the learner, finance and platform views as data grows.
- **One real N+1 removed.** The daily faculty-expiry job ran one query per batch. It now runs one query in total.
- **Four sequential page waterfalls turned parallel**: the admin dashboard, the learner home, the platform institute page and the public course page.
- **14 unused functions removed** (about 100 lines), with no references anywhere in the code or tests.

Behaviour, copy and UI are unchanged. Typecheck, lint, all 1,780 tests and the production build pass.

The three largest scale risks are not fixed here, because fixing them changes behaviour or touches files other teams own. All three are in the findings table as Recommended:

1. The institute People lists load every person in one query (PERF-06).
2. Several admin lists have no paging (PERF-07).
3. `/marketplace`, `/site/*` and a few other route trees have no loading state (PERF-10).

Client bundle size did not change, because no client code was touched. The first-load JavaScript figures below are the baseline for the next pass.

## Codebase at a glance

Measured with `find`, `wc` and `grep` on the review commit.

| Measure | Value |
|---|---|
| TypeScript/TSX files under `src/` | 829 |
| Lines of code under `src/` | 115,208 |
| Lines of test code (`tests/`) | 29,307 |
| Test files / tests | 167 files / 1,780 tests |
| Feature modules (`src/modules/`) | 16 (15 registered, plus the marketing site) |
| Database tables | 127 (25 core, 102 in modules) |
| Indexes in the database | 330 after this pass (311 before) |
| Pages (`page.tsx`) | 165 |
| Route handlers (`route.ts`) | 39 |
| Routes in the build | 167 |
| Client components (`"use client"`) | 123 files |
| Largest source files | `enrolment.ts` 1,145 lines, `assignments.ts` 1,038, `identity/auth.ts` 966, `data-console.ts` 952 |

Busiest shared code, from the graph report: `spaceContext`, `withTenant`, `ui.tsx`, `core/index.ts`, `authz/engine.ts` and `marketplace/service.ts`. A change in these touches the most code.

## Findings

| ID | Impact | Area | Finding | Where | Status |
|---|---|---|---|---|---|
| PERF-01 | High | Database | 184 foreign keys have no index that starts with them. The worst are on core tables read on every learner and finance screen: `orders.user_id`, `orders.enrolment_id`, `orders.batch_id`, `enrolments.course_id`, `batches.department_id`, `programs.department_id`, `parent_links.student_user_id`. | `src/db/schema.ts` | Fixed for the hot ones (see Indexes added). The rest are `created_by`/`updated_by` audit columns that are never searched, so they are left alone. |
| PERF-02 | High | Database | Common filters had no matching index. Examples are courses and batches by status inside an institute, enrolments by status, orders by date, session overrides by batch and date, and live role assignments by role. Under RLS, every query is also filtered by `university_id`. | `src/db/schema.ts` | Fixed |
| PERF-03 | Medium | Database | `audit_log`, the table that grows fastest, could only be searched by institute and time. The platform "person" page filters it by actor and would scan the whole table. | `src/db/schema.ts`, `zinny-team-panel/services/people.ts` | Fixed (`audit_actor_at_idx`) |
| PERF-04 | Medium | Database | N+1: `facultyExpiryAlerts` (daily job) ran one query per open batch to load faculty. It now loads all faculty in one query. | `src/server/services/batches.ts` | Fixed |
| PERF-05 | Medium | Rendering | Sequential awaits that could run together. The admin dashboard ran 3 rounds before its main `Promise.all`; it now runs 2. The platform institute page ran invoices, people and support sessions one after another. The public course page ran course and home one after another. The learner home loaded learning and notifications only after the timetable. | `app/[uni]/admin/page.tsx`, `app/platform/institutes/[id]/page.tsx`, `app/site/[uni]/courses/[courseId]/page.tsx`, `app/[uni]/learn/page.tsx` | Fixed |
| PERF-06 | High | Database | `listPeople` (institute Users pages) loads and sorts every person in a group in one query, then filters in memory. At 10,000 students that is one very large query and page on every open. | `src/server/services/users.ts`, `app/[uni]/admin/users/[group]/page.tsx` | Recommended: page it in the query (the platform People page already does this), with search in SQL |
| PERF-07 | Medium | Database | About 70 `list*`/`my*` services have no `limit`. Most are small per institute (departments, templates, categories). The ones that will grow: `listBatches`, `listCourses`, `listEnrolmentRequests`, `listSwitchRequests`, `listTests`, `listListings`, `listSignups`, `listUniversities` (platform), `myManualInvoices`. | `src/server/services/*`, `src/modules/*` | Recommended: add paging page by page, since each needs its own UI. |
| PERF-08 | Low | Database | The hourly `syncAllAlerts` job and the daily jobs go through institutes one at a time. Fine at today's size. At hundreds of institutes it will run for minutes. | `zinny-team-panel/services/licences.ts` | Recommended: one job per institute (see scale advice) |
| PERF-09 | Medium | Bundle | GSAP (about 70 kB gzipped, in 2 chunks) is loaded on the marketplace listing page, through `add-to-cart.tsx` and `listing-book.tsx`. The project rule is GSAP on the landing page only. | `modules/marketplace/components/` | Recommended: load it on demand with `import("gsap")` inside the effects |
| PERF-10 | Medium | Rendering | Only 3 `loading.tsx` files exist (`platform`, `[uni]/admin`, `[uni]/learn`). `/marketplace`, `/site/[uni]` (public institute websites) and `/[uni]/profile` show nothing until the server finishes. | `src/app/marketplace`, `src/app/site` | Recommended: add a skeleton `loading.tsx` to each |
| PERF-11 | Medium | Bundle | Heaviest admin pages carry editors and charts: the lesson editor and blog editor (320 kB, Tiptap), and Insights (296 kB, Recharts). Learner pages carry neither, which is good. | see build sizes | Recommended: lazy-load the editor and chart code with `next/dynamic` |
| PERF-12 | Low | Rendering | 11 plain `<img>` tags (user uploads and signed media URLs) and only 3 uses of `next/image`. `next/image` needs remote patterns in `next.config.ts`, which was out of scope. | `components/ui.tsx`, `website-builder/components/*`, `marketplace/components/live.tsx` | Recommended |
| PERF-13 | Low | Rendering | Marketplace and learner pages that map over a list and call a service per row (`getSite` per institute card, `batchOptions` per active course). Each is bounded by page size or by one student's active courses, so it is cheap today. | `marketplace/components/browse.tsx`, `app/[uni]/learn/my/page.tsx` | Recommended: batch the lookups if page sizes grow |
| PERF-14 | Low | Code health | 14 exported functions and components with no reference anywhere in code or tests. Removed: `waitingItems`, `courseTests`, `poolTags`, `canViewXp`, `canManageScoped`, `batchIsInReach`, `labelChars`, `enquiryCounts`, `partnerOwners`, `seatPackDefaults`, `missingGlyphs`, `MiniStat`, `ScopeChip`, `ReloadAt` (about 100 lines, plus 7 unused imports). | modules | Fixed |
| PERF-15 | Low | Code health | Left alone on purpose: unused functions that are write services, in auth or session code, or in `src/server`: `makePrimaryContact`, `deleteCourse`, `listPrograms`, `listSales`, `markRead`, `cancelHoldAction`, `liveSessionIds`, `openInviteCount`, `photoUrls`. Also some unused exported constants and types (`CSV_COLUMNS`, `REMINDER_DAYS`, `PARTNER_*_LABELS`, `platPlanLegacy`). Each is either a feature waiting for UI or lives in code another team is changing. | various | Recommended: the owners decide |
| PERF-16 | Low | Code health | Very large files: `enrolment.ts` (1,145 lines), `assignments.ts` (1,038), `auth.ts` (966), `data-console.ts` (952). They work, but they are where a change is most likely to break something. | see Codebase at a glance | Recommended: split by use case when next touched |
| PERF-17 | Low | Build | `next build` reports no per-route size column in this Next.js version. Sizes below were measured from the build output (gzip of each route's first-load JavaScript). Median route is 194 kB. | `.next` | Info |

## Indexes added

All are plain `index()` additions. No columns, constraints or policies changed. Applied with `npm run db:push`.

| Table | Index | Columns | Helps |
|---|---|---|---|
| `programs` | `programs_dept_idx` | `department_id` | Department delete and program lists |
| `batches` | `batches_uni_status_idx` | `university_id, status` | Open and closed batch lists, dashboard counts |
| `batches` | `batches_dept_idx` | `department_id` | Department-scoped batch lists |
| `courses` | `courses_uni_status_idx` | `university_id, status` | Course catalogue, published counts |
| `enrolments` | `enrolments_course_idx` | `course_id` | Course roster, course delete |
| `enrolments` | `enrolments_uni_status_idx` | `university_id, status` | Active seat counts, request queues |
| `orders` | `orders_user_idx` | `user_id` | A student's order history |
| `orders` | `orders_uni_created_idx` | `university_id, created_at` | Sales lists and reports by date |
| `orders` | `orders_enrolment_idx` | `enrolment_id` | Invoice and refund lookups |
| `orders` | `orders_batch_idx` | `batch_id` | Batch revenue |
| `session_overrides` | `session_overrides_batch_date_idx` | `batch_id, date` | Timetable reads, one per batch per week |
| `parent_links` | `parent_links_student_idx` | `student_user_id` | Finding a child's parents |
| `audit_log` | `audit_actor_at_idx` | `actor_user_id, at` | Activity by person |
| `role_assignments` | `role_assignments_uni_role_idx` | `university_id, role` where not revoked | People lists, seat counts |
| `assess_attempts` | `assess_attempts_batch_idx`, `assess_attempts_course_idx` | `batch_id` / `course_id` | Test results by batch and course |
| `content_lesson_progress` | `content_lesson_progress_course_idx` | `course_id` | Course progress reports |
| `mkt_listings` | `mkt_listings_university_idx` | `university_id, status` | A seller's own listings |
| `plat_seat_packs` | `plat_seat_packs_invoice_idx` | `invoice_id` | Invoice to seat packs |

Checked and already well covered, so unchanged: the `onb_*` tables (unique per institute, tiny), the `dpdp_*` tables (indexed by user, by institute and status, and a partial index for open retention flags), `gam_*`, `notif_*`, `live_*`, `asgn_*` and `cert_*`.

Write cost: each index adds a small cost to inserts. The busiest write table (`audit_log`) gets one extra; the others are written rarely compared to how often they are read.

## Build sizes

First-load JavaScript per route: gzipped size of the route's own chunks plus the shared framework chunks. Measured from `.next` after `npm run build`.

| Route | Before | After |
|---|---|---|
| `/[uni]/admin/products/content/lessons/[lessonId]` | 320 kB | 320 kB |
| `/[uni]/admin/website/sections/blog/[id]` | 320 kB | 320 kB |
| `/[uni]/admin/insights` | 296 kB | 296 kB |
| `/` (landing page) | 257 kB | 257 kB |
| `/marketplace/[listingId]` | 222 kB | 222 kB |
| `/platform/data` | 209 kB | 209 kB |
| `/platform/licences/[id]` | 204 kB | 204 kB |
| `/platform/institutes/new` | 203 kB | 203 kB |
| `/platform/roles` | 203 kB | 203 kB |
| `/platform/privacy/breaches` | 202 kB | 202 kB |

Unchanged on purpose: this pass touched no client code. The build compiles in 30 to 41 seconds and passes with 167 routes.

The shared base is about 190 kB gzipped on every route, which is the main cost for learners on mobile data. Look at what the shared chunks contain before cutting individual pages.

## Recommendations for scale

1. **Connection pooling.** Use Neon's pooled endpoint (PgBouncer, transaction mode) for the app, and the direct endpoint for migrations. Each request opens a transaction with `withTenant`, so keep transactions short and avoid awaiting slow work (storage, email, gateways) inside them.
2. **Paging everywhere a list can grow.** Start with Users (PERF-06), then Batches, Courses, Enrolment requests and the platform Institutes list. Use keyset paging (`created_at, id`) on the biggest tables (`audit_log`, `orders`, `notifications`).
3. **Caching public pages.** Institute websites (`/site/*`) and the marketplace change rarely. Cache them with `revalidate` and tags, and revalidate on publish. This removes most database reads from anonymous traffic. Add a CDN in front for the same pages.
4. **Cache small shared reads per request.** `spaceContext`, `getSite`, plan and licence lookups run on most pages. Wrap them in React `cache()` so one request reads them once.
5. **Background jobs.** Move the hourly and daily jobs (alert sync, faculty expiry, retention, notification delivery, fee reminders) to a queue with one job per institute, so one slow institute never holds up the rest. Vercel Cron to a queue (Inngest, Trigger.dev or QStash) is enough.
6. **Media on a CDN.** Serve lesson video, certificates and uploads from object storage behind a CDN with signed URLs, never through the app server. Use HLS for video.
7. **Read replica.** Platform analytics, reports and exports are read-heavy and can tolerate a few seconds' lag. Send them to a Neon read replica.
8. **Table growth.** `audit_log`, `domain_events`, `notifications`, `notif_deliveries` and `gam_activity` will be the largest tables. Partition by month once any passes about 50 million rows, and archive old `domain_events` and delivered notifications on a schedule.
9. **Region.** Keep the database and Vercel functions in the same region (Mumbai for Indian institutes). A database round trip across regions costs more than any query tuning.
10. **Watch it.** Turn on `pg_stat_statements` and Vercel's slow-function log, and review the ten slowest queries each month. Today's indexes are chosen from reading the code; real traffic should confirm them.
