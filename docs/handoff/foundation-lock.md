# foundation-lock handoff

Tag `foundation-v1` is on the last commit of this work, on `main`. There is no git remote, so nothing was pushed. Module agents branch from the local tag.

## Built

**Module system**
- `src/contracts/`: the frozen types.
  - `module.ts`: `ZinnyModule`, `ModuleId` (the 12 ids in `ownership.json`), the slots, `ReportDefinition`, `Job`, `SeedContext`.
  - `events.ts`: `EventMap` for the whole catalogue, `EventHandler`, `defineHandler`.
  - `core.ts`: the shapes the core API returns.
  - `storage.ts`, `mail.ts`, `sms.ts` and `payments.ts`.
- `src/modules/<module>/index.ts` and `schema.ts` exist for all 12 modules. Each `index.ts` **default-exports** its module.
- `npm run gen` (`scripts/gen-registry.ts`) writes `src/generated/registry.ts`, which is gitignored. It runs before `dev`, `build`, `test`, `typecheck` and `db:seed`.
- `src/server/registry.ts` provides `slot`, `visibleSlots`, `slotsInReach`, `reports`, `jobs`, `eventHandlers`, `seeds`, `mailTransport`, `smsTransport`, `paymentGateway` and `setTestModules`.

**Events**
- Core tables `domain_events` and `domain_event_deliveries`.
- `emit(tx, actor, type, payload)` writes in the caller's transaction. Delivery runs after the response through Next `after()`.
- `drainEvents()` delivers each pair in a savepoint, under the event's tenant, with row locks so it's safe when several drains run at once. It retries with backoff and gives up after 10 attempts.
- `GET /api/jobs/events` is the cron safety net. Test helpers are in `tests/helpers/events.ts`.
- Core emits `enrolment.confirmed` (free and paid), `payment.confirmed`, `enrolment.switched`, `enrolment.ended`, `enrolment.completed`, and `user.invited` (add person, CSV import, parent link, create university, platform role grant).

**Permissions**
- Every action in contracts section 9 is in `roles.ts`, with its grants.
- Every `self.*` action is in `SELF_ACTIONS`, and `self.profile` goes to every university role.
- `tests/authz.test.ts` has an allow and a deny case per module.

**Row-level security**
- `policies.sql` finds tables by their `university_id` column, so it lists none.
- `npm run db:push` runs `drizzle-kit push --force` and then applies `policies.sql`.
- Tests: `tests/core/rls-coverage.test.ts`, and the helper `expectTenantIsolated` in `tests/helpers/isolation.ts`.

**Curriculum**
- `content_sections`, `content_lessons`, the service, the actions and the Curriculum tab now live in `src/modules/content-progress/`.
- The tab is registered as `adminCourseTabs.curriculum`.

**Core API** (`src/server/core/index.ts`)
- Exactly the list in section 8, with the 17 new functions implemented.
- Storage: local disk with HMAC-signed links served by `/api/storage`, or S3/R2 with SigV4. The S3 signing is checked against AWS's reference example.
- Console email and SMS transports.
- The mock gateway now has `refund`. The Razorpay draft moved to `src/modules/payments/razorpay.ts` and is not registered.

**Slots in core pages**
- Admin course page: Batches, Settings and the registered tabs. The three hard-coded placeholder tabs are gone.
- Admin batch page: registered sections render under the timetable.
- New course hub at `/[uni]/learn/my/[enrolmentId]`. `/learn/my` links each course to its hub and shows the hub sections.
- Learner home cards and admin dashboard cards render in their places.
- Join buttons point to `/[uni]/learn/join/[batchId]/[date]`.
- `tests/core/slots.test.tsx` proves every slot with a module that is registered only in tests.

**Jobs and seeds**
- `GET /api/jobs/run?every=minute|hour|day`. The old `/api/jobs/daily` is now the core job `core.daily-housekeeping`.
- The seed runner runs the core seed, then each module's `seed(ctx)` in alphabetical order.

**Per-agent setup and ownership**
- `scripts/agent-setup.ts`: `DATABASE_ADMIN_URL` defaults to `postgres://zinny_owner:zinny@localhost:5432/postgres`. Re-running it is safe; `--reset` recreates both databases.
- `scripts/check-ownership.ts` matches path prefixes literally.
- Next (dev and start, including `PORT`), Drizzle, the seed and the tests all read `.env.local`, then `.env`.

**Tests:** 149 pass, up from 67 (82 new).

## Not built (and why)
- No module features beyond moving the curriculum. That is out of scope.
- The `/learn/join` route belongs to live-classes, so Join buttons lead to a 404 until it is built.

## Contracts used / provided
`docs/plan/contracts.md` now matches the code. It adds the details the code makes concrete: default export, slot props and targets, handler retry rules, the `SeedContext` shape, storage and mail signatures, return shapes, and the `self.*` rule.

Deviations from the original contract text:
1. **Platform events.** `user.invited` for a Zinny team member has `universityId: null`. Handlers get a platform system actor and no tenant transaction, so a handler that writes tenant tables must skip these events.
2. **`enrolment.ended` reasons.** The emitted value is `reason: "graduated"`. The type also allows `"cancelled"`, but nothing emits it: core has no way to cancel an active enrolment, and a cancelled hold is excluded by the brief.
3. **`domain_event_deliveries` columns.** It also has `university_id` and `next_attempt_at`. The first is needed so the delivery record is written in the same tenant transaction as the handler's work; the second drives the retry backoff.
4. **`self.*` rule.** The engine now accepts any active role in the university that grants a `self.*` action. Before, the rule depended on the role's scope, which would have denied `self.profile` to HODs and faculty.

## New packages
None.

## New environment variables
- `CRON_SECRET`: existing, now also guards `/api/jobs/run` and `/api/jobs/events`.
- `DATABASE_ADMIN_URL`: used only by agent setup.
- `TEST_DATABASE_URL` and `TEST_DATABASE_URL_OWNER`: written to `.env.local` by agent setup.
- Storage: `STORAGE_DRIVER`, `STORAGE_DIR`, `STORAGE_SIGNING_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`.

## What module agents must know
- Your `index.ts` must `export default` a `ZinnyModule` whose `id` is your folder name. Register handlers with `defineHandler` and give them unique ids of the form `<module>.<name>`.
- Run `npm run db:push` after you change your schema. If it reports that it needs to ask about a rename, run `npm run db:reset && npm run db:seed`, because push can't ask outside a terminal.
- Tests reset the test database on every run, through push and then policies.
- `makeRow` in `expectTenantIsolated` is called twice for the same university, so use `uniqueCode()` from `tests/fixtures.ts` for any unique column. `setupCourse()` there gives you a university, a department, admin, HOD, faculty, and a published course with one batch.
- To test your slots in isolation, call `setTestModules([yourModule], { only: true })` and reset it with `setTestModules([])`. To render a slot in a test, use `prerenderToNodeStream` from `react-dom/static.node`, as in `tests/core/slots.test.tsx`.
- Scripts and tests run server code with `server-only` stubbed out and JSX compiled. Pages still need to be built with `next build` to be checked.
- Link to the join route with a plain `<a>`, never `<Link>`. A `<Link>` would prefetch it, and the route has side effects.
- The click-through changes data: it approves Kabir's switch and enrols Tara. Run `npm run db:seed` before every run.
- `content-progress` (port 3104): the tab's permission is `course.view` and editing needs `course.update`, as before the move. Switching them to `content.manage` is your job.

## Kickoff (verified on a fresh worktree of foundation-v1)
```bash
git worktree add /tmp/zinny-smoke foundation-v1 && cd /tmp/zinny-smoke
npm install
npm run agent:setup -- smoketest 3199   # roles, zinny_smoketest(+_test), .env.local, db:push both, db:seed
npm test                                # 149 passed
npm run typecheck && npm run lint
AGENT=live-classes npm run check:ownership   # passes on own paths, fails on src/server/registry.ts
npm run dev                             # served on http://localhost:3199
```
After that I removed the worktree and dropped both databases. In the main checkout, `npm run build` passes, and `python3 -I scripts/e2e/clickthrough.py <dir>` against `ZINNY_DEMO=1 PORT=3000 npm start` on a freshly seeded database prints `FAILED: 0` (25 checks, no page errors).

## Requests for other owners
None.

## Known issues
- The integrator needs a migration for the renames `course_sections` → `content_sections` and `lessons` → `content_lessons`. `drizzle/0000_init.sql` still has the old tables. Rename them rather than dropping them, so existing data survives.
- Dev databases set up before this change must be recreated with `npm run db:reset && npm run db:seed`.
