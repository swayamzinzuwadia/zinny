---
name: foundation-lock
description: Runs first and alone. Turns the existing Zinny codebase into a contract-first base so twelve module agents can then build in parallel without touching each other's files. Use only for the foundation step.
model: opus
effort: high
---

# Agent: foundation-lock

Read `CLAUDE.md`, `docs/plan/README.md`, `docs/plan/contracts.md` and `docs/plan/ownership.json` first. Your job is to make every contract in `contracts.md` real, so that after you finish, each module agent only ever edits its own folder and routes.

You run in the main checkout, on `main`, before any other agent. Nobody else is working, so you may edit any file. Everything you build becomes read-only for the module agents, so get the interfaces right: they cannot change them.

## Starting point

The repo already contains a working, tested core: schema with row-level security, the roles-and-scope engine, courses, batches, enrolment with seat holds, clash check, batch switching, timetable, GST invoices, admin panel, learner app, Zinny team panel, seed data and 67 tests. Keep all of it working. Run `npm test` first and keep it green throughout.

## Must have

### 1. Repo setup
- Add `.claude/worktrees/` and `src/generated/` to `.gitignore`. Add a `.worktreeinclude` containing `.env`.
- Keep `docs/prd/Zinny_Product_Requirements.pdf` in the repo.

### 2. Module system and registry
- `src/contracts/module.ts`: the `ZinnyModule` type and every slot, report, job, seed and transport type exactly as in contracts.md, plus `ModuleId` as a union of the 12 module ids in `ownership.json`.
- Create `src/modules/<module>/index.ts` for all 12 modules, each exporting a stub `{ id }`, plus an empty `src/modules/<module>/schema.ts`.
- `scripts/gen-registry.ts`: scans `src/modules/*/index.ts` and writes `src/generated/registry.ts` (gitignored). Wire it into `predev`, `prebuild`, `pretest` and `pretypecheck`, and as `npm run gen`.
- `src/server/registry.ts`: typed accessors (`slot(name)`, `reports()`, `jobs()`, `eventHandlers()`, `seeds()`, `mailTransport()`, `smsTransport()`, `paymentGateway()`), sorted by `order`. A slot is shown only to people who pass its `action` against the page's target.

### 3. Events
- Core tables `domain_events` (id, university_id, type, payload jsonb, actor_user_id, occurred_at) and `domain_event_deliveries` (event_id, handler_id, delivered_at, attempts, last_error; unique on event_id + handler_id).
- `src/contracts/events.ts`: an `EventMap` typing every event in the catalogue, and the `EventHandler` type.
- `emit(tx, actor, type, payload)` inserts in the caller's transaction and schedules delivery after the response (Next `after()`).
- `drainEvents({ universityId? })`: delivers each undelivered (event, handler) pair inside `withTenant(systemActorFor(universityId))`, records success or failure, retries with backoff, gives up after 10 attempts.
- `GET /api/jobs/events` (cron, `CRON_SECRET`) as the safety net. `tests/helpers/events.ts` exports `drainEvents` for tests.
- Make core emit: `enrolment.confirmed` (paid and free), `payment.confirmed`, `enrolment.switched`, `enrolment.ended` (graduation, cancelled hold excluded), `enrolment.completed` (new `markEnrolmentCompleted`), and `user.invited` (add person, CSV import, create university) whenever the person has no password yet.
- Tests: an event is delivered once per handler even when `drainEvents` runs twice; a failing handler doesn't block others; events from university A are delivered under A's tenant only.

### 4. Permissions
- Register every action in contracts.md section 9 in `src/server/authz/roles.ts`, with the grants listed there. Add the new `self.*` actions to `SELF_ACTIONS`. Faculty grants still apply only from batch assignments.
- Grant `self.profile` to every university role.
- Extend `tests/authz.test.ts` with an allow and a deny case per module.

### 5. Schema, row-level security and databases
- `drizzle.config.ts` schema: `["./src/db/schema.ts", "./src/modules/*/schema.ts"]`.
- Move `course_sections` and `lessons` into `src/modules/content-progress/schema.ts` as `content_sections` and `content_lessons`. Move the curriculum service functions and the Curriculum tab UI into `src/modules/content-progress/`, registered as its `adminCourseTabs` entry, so the feature keeps working.
- Rewrite `src/db/policies.sql` so it no longer lists tables:
  - every `public` table with a `university_id` column gets RLS enabled and the `tenant_isolation` policy;
  - the app role gets select/insert/update/delete on those tables (append-only on `audit_log` and `domain_events`);
  - every table without `university_id` is revoked from the app role, except `users` and `universities`, which keep their special policies;
  - `alter default privileges` does not grant anything to the app role by default.
- `npm run db:push`: `drizzle-kit push --force`, then apply `policies.sql`. Tests do the same against a fresh test database (drop schema, push, policies). Keep `npm run db:migrate` for production; the integrator generates migrations.
- `tests/core/rls-coverage.test.ts`: fails if any table with `university_id` lacks RLS and the policy, or if the app role can read any table without `university_id` other than `users` and `universities`.
- `tests/helpers/isolation.ts`: `expectTenantIsolated(table, makeRow)`. It creates two universities, inserts a row for A, and asserts that B's actor can neither see it nor insert a row carrying A's id.

### 6. Per-agent environment
- `scripts/agent-setup.ts <agent> <port>`: connects with `DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`), creates the roles `zinny_owner` and `zinny_app` if missing, creates databases `zinny_<agent>` and `zinny_<agent>_test`, and writes `.env.local` with `AGENT`, `PORT` and the four database URLs. Then it runs `db:push` and `db:seed`. Make Next, Drizzle, the seed and the tests all read `.env.local`.
- `scripts/check-ownership.ts` (`npm run check:ownership`): reads `AGENT` and `docs/plan/ownership.json`. It lists files changed since the tag `foundation-v1`, both committed and uncommitted, and fails on any path outside the agent's prefixes, `shared`, `tests/<module>/`, `docs/handoff/<agent>.md` or `docs/handoff/<agent>/`. Match literal prefixes, not globs, because route folders contain brackets.

### 7. Core API facade and contracts
- `src/server/core/index.ts` exports exactly the list in contracts.md section 8. Implement the ones that don't exist yet: `universityLite`, `todayFor`, `peopleLite`, `getCourseLite`, `batchLite`, `listCourseBatches`, `facultyBatchIds`, `batchStudentIds`, `studentEnrolments`, `enrolmentById`, `markEnrolmentCompleted`, `orderForCheckout`, `markOrderRefunded`, `orderUniversity`, `updateUniversity`, `grantPlatformRole`, `revokePlatformRole`. Each one checks permission where a person is acting. `markEnrolmentCompleted` is idempotent: calling it on a completed enrolment does nothing and emits nothing.
- `src/contracts/storage.ts` with a local-disk implementation (`./.storage`, gitignored) and an S3-compatible implementation chosen by env. `src/contracts/mail.ts` and `sms.ts` use console transports unless a module registers one. `src/contracts/payments.ts` holds the `PaymentGateway` interface (add `refund`); the mock stays in core; move the Razorpay draft into `src/modules/payments/razorpay.ts`, unregistered.

### 8. Slots in core pages
- Admin course page: core tabs Batches and Settings plus registered `adminCourseTabs`. Remove the hard-coded Assignments, Live classes and Certificates placeholders.
- Admin batch page: render `adminBatchSections` under the timetable.
- New learner course hub `/[uni]/learn/my/[enrolmentId]`: header with course, batch, timings and faculty, the switch-batch action, then `learnerCourseTabs`. Make `/[uni]/learn/my` link each course to its hub and render `learnerHubSections` below the list.
- Learner home renders `learnerHomeCards` after "Today". Admin dashboard renders `dashboardCards` after "Seats by batch".
- Join buttons on the learner home and timetable link to `/[uni]/learn/join/[batchId]/[date]` (live-classes builds that route).
- Every slot area handles "nothing registered" quietly. Prove the slots work with a test module registered only in tests.

### 9. Jobs and seeds
- `GET /api/jobs/run?every=minute|hour|day` (`CRON_SECRET`) runs registered jobs once per university as its system actor. Move the existing daily job (seat-hold release, faculty-expiry alerts) into a core job.
- Seed runner: core seed, then each module's `seed(ctx)` in alphabetical order, with `ctx` as in contracts.md section 6.

## Must not
- Build any module feature beyond moving the existing curriculum code.
- Change the behaviour of existing core features.

## Done
- Everything above works. `npm test` (old and new tests), `npm run typecheck`, `npm run lint` and `npm run build` pass. The existing click-through still passes.
- `docs/plan/contracts.md` matches what you built exactly. Fix the code, not the contract, unless the contract is impossible; then update the contract and say why in your handoff.
- Commit on `main`, tag `foundation-v1`, push the branch and the tag.
- Write `docs/handoff/foundation-lock.md`: what changed, anything module agents must know, and the exact kickoff commands verified on a clean clone.
