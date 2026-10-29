# Zinny v2

Education platform sold to institutes and universities. Each one gets its own private space to run courses, batches, tests and students. Built from the *Zinny product requirements* (October 2026).

## What's in this build (Phase 1, milestone 1)

| PRD | Status |
|---|---|
| Users and roles: user + role + scope (platform, university, department, batch) | Done |
| Who sees what (page 3 matrix), checked on the server for every action | Done |
| Separate spaces: Postgres row-level security, so no query can reach another university | Done |
| Zinny team access only through support mode, every action logged | Done (Super Admin, Support Agent) |
| Departments with HOD, faculty and courses; programs | Done |
| Bulk import by CSV, all-or-nothing, no duplicates on re-import | Done |
| Graduate student → alumni (keeps certificates, loses program courses); parent links | Done |
| HOD creates courses and batches in own department only | Done |
| Batches: days and timings, dates, seat limit, at least one faculty | Done |
| Visiting faculty access end date, HOD warned before it runs out | Done |
| Student picks a batch; full batches shown but can't be picked | Done |
| Seat held 10 minutes while paying; safe when many students click at once | Done |
| Clash warning before enrolling | Done |
| Batch switch: student requests, HOD approves only if a seat is free | Done |
| Timetable built automatically, updates instantly, notifications on change | Done |
| Cancel / move / extra class (holidays) | Done |
| Payments tagged with course, batch and university; GST invoice for every paid order | Done (mock gateway; Razorpay adapter + webhook ready) |
| Admin panel menu (page 4), learner app (mobile first), Zinny team panel | Done (core screens) |
| Tests and question pool, live classes and attendance, assignments, certificates | Next sprints |
| Phase 2 and 3 (leaderboards, reports, website builder, marketplace) | Later |

## Run it locally

Needs Node 20+ and Postgres 14+.

```bash
npm install
npm run agent:setup -- dev 3000   # creates roles, zinny_dev + zinny_dev_test, .env.local; pushes schema; seeds
npm run dev                       # http://localhost:3000/login
```

`agent:setup` connects as a Postgres superuser through `DATABASE_ADMIN_URL` (default `postgres://zinny_owner:zinny@localhost:5432/postgres`) and creates the two roles if missing: `zinny_owner` owns the tables, `zinny_app` is what the app uses, so row-level security always applies to it. Or fill in `.env` by hand from `.env.example` and run `npm run db:push && npm run db:seed`.

| Command | What it does |
|---|---|
| `npm run gen` | Rebuilds `src/generated/registry.ts` from `src/modules/*/index.ts` (runs before dev, build, test, typecheck, db:seed) |
| `npm run db:push` | Applies the schema (core + every module) and row-level security to the dev database |
| `npm run db:reset` | Drops everything in the dev database, then pushes. Use when push needs to ask about a rename |
| `npm run db:seed` | Demo University, then every module's seed |
| `npm run db:migrate` | Production: applies `drizzle/` migrations, then row-level security |
| `npm run check:ownership` | For module agents: fails on changes outside their ownership since `foundation-v1` |

The login page lists one-click demo accounts (password for all: `zinny123`). Demo accounts are shown in development only, or when `ZINNY_DEMO=1`. They sign in without a password, so never set `ZINNY_DEMO` on a deployment with real data.

| Account | What to look at |
|---|---|
| hema@demo.edu (HOD, Computer Science) | Pending batch switch from Kabir, faculty-expiry alert, Data Analytics with the three batches from PRD page 5 |
| riya@demo.edu (student) | Timetable → Next week: exactly the PRD page 6 example week |
| tara@demo.edu (student) | Data Analytics → pick Weekday evening to see the clash warning |
| vikram@demo.edu (visiting faculty) | Only his own batch and students |
| arun@demo.edu (Accounts & Fees) | Sales with GST invoice numbers |
| bharat@demo.edu (Board) | Read-only |
| sid@zinny.demo (Support Agent) | Enter support mode, then see the log |
| pallavi@demo.edu (parent) | Riya's week, read only |

## Tests

```bash
npm test          # against a separate test database (TEST_DATABASE_URL*, default zinny_test), reset on every run
```

Covers the page 3 matrix, scope checks, row-level security (cross-university reads and writes are refused by the database itself), support-mode logging, the seat race (five students, one seat, exactly one wins), hold expiry and late payments, clash detection, timetable building with cancelled and moved classes, batch switching, CSV import, graduation and parent access.

## Brand

Colours come straight from the logo: Zinny green `#0B5E4C`, gold `#D4A72A` and cream `#FAF6EA` (tokens in `src/app/globals.css`). Type is Lexend, a typeface designed to make reading easier. Logo files live in `public/brand/`: the mark, the wordmark in green and in cream (for dark backgrounds), and the full lockup.

The dashboard opens on the **Today board**: the day's classes laid out like a bell schedule, with a gold line for the current time. Under it: what needs you (switch requests, faculty about to expire, batches filling up, refunds), key numbers, and a seat map for every batch. Accounts staff, who don't see batches, get the month's collections on the board instead.

## How the code is laid out

```
src/db/schema.ts            Data model. Every university table has university_id.
src/db/policies.sql         Row-level security and grants, found by column: every table with university_id is isolated.
src/contracts/*             The module contracts: module, events, storage, mail, sms, payments, core shapes.
src/modules/<module>/       Twelve modules, each registering into core through its index.ts.
src/server/core/index.ts    The core API modules may use (contracts.md section 8).
src/server/registry.ts      What modules registered: slots, reports, jobs, handlers, seeds, transports.
src/server/authz/roles.ts   Roles → actions. Add a role here; nothing else changes.
src/server/authz/engine.ts  can(actor, action, target): role grants it AND scope contains target.
src/server/authz/menu.ts    The admin menu and the page 3 matrix.
src/server/tenant.ts        withTenant(): every request runs in a transaction locked to one university.
src/server/services/*       All business rules. Pages and actions only call these.
src/app/[uni]/admin         Admin panel (desktop and tablet).
src/app/[uni]/learn         Learner app (mobile first).
src/app/platform            Zinny team panel.
tests/                      Vitest, against a real Postgres.
```

### Rules for anyone adding features

1. Business rules go in `src/server/services`, never in pages.
2. Every service function calls `assertCan` (or `reach` for lists) before touching data, and runs inside `withTenant`.
3. Every change calls `audit(...)`.
4. `systemDb()` bypasses row-level security. Only sign-in, the Zinny team panel, webhook lookups and migrations may use it.
5. New table holding university data → add `university_id`; row-level security applies automatically.
6. New rule → new test.

## Payments

Without Razorpay keys the app uses a mock gateway with a "Pay (test mode)" button. To go live, set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, and point a Razorpay webhook (`payment.captured`, `payment.failed`) at `/api/payments/razorpay`. The checkout widget on the learner checkout page is the next small task.

Invoice numbers look like `DEMO/26-27/00001`: a prefix of up to 4 characters, the Indian financial year, and a running number, which keeps them within GST's 16-character limit.

## Scheduled jobs

Call these with `Authorization: Bearer $CRON_SECRET` (Vercel Cron or any scheduler):

| Route | When | What |
|---|---|---|
| `GET /api/jobs/run?every=minute` | every minute | module jobs that run every minute |
| `GET /api/jobs/run?every=hour` | every hour | module jobs that run hourly |
| `GET /api/jobs/run?every=day` | once a day | releases lapsed seat holds, warns HODs about visiting faculty whose access ends before their batch, plus daily module jobs |
| `GET /api/jobs/events` | every minute | retries event deliveries that failed or were missed |

`vercel.json` schedules all four on Vercel (the daily run at 18:45 UTC, 00:15 in India). Vercel adds the `Authorization` header itself when `CRON_SECRET` is set. Cron jobs that run every minute need a Vercel Pro plan; on Hobby, use an external scheduler for the two minute routes.

## Recommended hosting

Vercel for the app, Neon or Supabase Postgres in the Mumbai region (ap-south-1). Use two database users exactly as above: the app user must not own the tables, or row-level security won't apply to it.
