# Zinny — rules for every agent

Zinny is an education platform sold to institutes and universities. Each one gets a private space to run courses, batches, tests and students. The product spec is `docs/prd/Zinny_Product_Requirements.pdf`. The build plan is `docs/plan/README.md`. Your own task is in `.claude/agents/<your-agent>.md`.

Several agents build Zinny at the same time, each in its own git worktree. That only works if everyone follows the rules below exactly. If a rule blocks you, do not work around it: write it in your handoff file (see the end) and carry on with the rest.

## Stack (fixed — do not change or add alternatives)

- Next.js 15 App Router, React 19, TypeScript (strict), server actions
- Tailwind CSS v4 with the brand tokens in `src/app/globals.css`; font Lexend
- PostgreSQL 16, Drizzle ORM; row-level security for tenant isolation
- Own session auth (bcrypt + httpOnly cookie)
- Razorpay for payments (mock gateway in dev)
- Vitest against a real Postgres; Playwright for click-throughs
- Hosting target: Vercel + Neon/Supabase Postgres (Mumbai)

## Commands

```bash
npm install
npm run agent:setup -- <agent> <port>   # once per worktree: creates your own dev + test databases and .env.local
npm run gen                             # rebuilds src/generated/registry.ts from src/modules/*/index.ts
npm run db:push                         # applies the current schema + row-level security to your dev database
npm run db:reset                        # wipes your dev database and pushes again (when push asks about a rename); then db:seed
npm run db:seed                         # core demo university, then every module's seed
npm run dev                             # uses the PORT from .env.local
npm test                                # all tests; npm test -- tests/<module> for yours
npm run typecheck && npm run lint
npm run check:ownership                 # fails if you changed a file you don't own
```

## Non-negotiable rules

1. **Business rules live in services.** Module code goes in `src/modules/<module>/`. Pages and server actions only call service functions.
2. **Every service function** checks permission first (`assertCan` for one record, `reach` for lists, from `@/server/authz/engine`), runs its queries inside `withTenant(actor, tx => …)`, and calls `audit(tx, actor, …)` for every write.
3. **Never use `systemDb()`** in module code. Jobs and webhooks use `systemActorFor(universityId)` with `withTenant`. The only exception is named in your brief.
4. **Every table holding university data** has `university_id uuid not null` referencing `universities`. Row-level security is applied automatically to any table with that column. Money is integer paise. Dates are `YYYY-MM-DD` strings; times of day are in the university's time zone.
5. **Stay inside your ownership.** Only create or edit files listed under "You own" in your brief. Everything else is read-only for you, including: `src/db/schema.ts`, `src/server/**`, `src/components/**`, `src/contracts/**`, `src/app/globals.css`, `drizzle.config.ts`, `CLAUDE.md`, `docs/plan/**`, other modules' folders, and other agents' routes. `npm run check:ownership` must pass before you finish.
6. **Talk to other modules only through contracts** (`docs/plan/contracts.md`): emit and handle events, register into slots, and call the core API in `@/server/core`. Never import another module's files and never query another module's tables. If you need data another module owns, it must arrive as an event payload. Core tables (the ones in `src/db/schema.ts`) are frozen during a wave: you may read them directly with `select`, but change them only through the core API.
7. **No migrations.** Never run `drizzle-kit generate` and never commit files under `drizzle/`. Use `npm run db:push`. The integrator generates migrations after merging.
8. **Dependencies:** you may `npm install` packages. List every one in your handoff file. New environment variables go in `src/modules/<module>/ENV.md`, not in `.env.example`.
9. **Tables and enums are prefixed** with your module's prefix (given in your brief), so names never collide.
10. **Tests are part of the work.** Every rule you implement gets a test in `tests/<module>/`. Every new table gets a tenant isolation test using `expectTenantIsolated()` from `tests/helpers/isolation.ts`. All core tests must still pass.

## Design and copy

- Use the components in `@/components/ui` and `@/components/forms` (Card, Badge, Button classes, Field, Input, Table, Tabs, Stat, Avatar, SeatMap, ActionForm, SubmitButton). Need a new component? Put it in `src/modules/<module>/components/`.
- Colours only from tokens: brand green, gold accent, cream canvas. Gold marks "now" and "needs attention"; don't use it as decoration.
- Copy: plain sentence case, active voice, buttons say exactly what happens ("Publish test", not "Submit"). No all-caps labels, no "→" on buttons, no exclamation marks. Errors say what went wrong and how to fix it.
- Admin panel works on desktop and tablet. Learner screens are mobile first; check them at 390 px wide.

## Definition of done

- [ ] Everything in your brief's "Must have" works end to end in the browser
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run check:ownership` pass
- [ ] Every new table has an isolation test; every permission rule has an allow and a deny test
- [ ] Your module's `seed` adds realistic demo data to the Demo University
- [ ] Screenshots of your main screens saved to `docs/handoff/<agent>/` (desktop; learner screens also at 390 px)
- [ ] `docs/handoff/<agent>.md` written (template below), and all work committed on your branch

## Handoff file template — `docs/handoff/<agent>.md`

```md
# <agent> handoff
## Built
## Not built (and why)
## Contracts used / provided   (events emitted and handled, slots registered, core API calls)
## New packages
## New environment variables   (also in src/modules/<module>/ENV.md)
## Requests for other owners   (a missing permission action, a core API, a contract change)
## Known issues
```
