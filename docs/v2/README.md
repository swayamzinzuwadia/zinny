# Zinny v2 master plan: three ways in, one platform

Companion files: [feature map](feature-map.md), [agent team and build cycle](agents.md), [connecting a direct institute's site](connection-playbook.md), [decisions needed](decisions-needed.md). The designed report is `Zinny_v2_Master_Plan.pdf`.

## 1. Context

After the client meeting, Zinny stops being one product sold one way. It becomes one management platform that an institute can use in three ways:

1. **White label**: the institute gets the whole product under its own name and web address.
2. **Direct**: the institute keeps its own website (for example sahyogcoachingclasses.com), its own login and its own payment gateway. Every sign-up and purchase on that site flows into Zinny, and the institute is run from Zinny.
3. **Marketplace**: any institute, subscribed or not, lists courses on Zinny's shop. Students buy there and learn there.

The direct way is the main one. Mobile apps for Android and iOS follow as phase 2.

Today's code cannot do this. It is a single site at one web address, with one shared account per email, one shared payment account, no way for an outside website to send anything in, and the Zinny name on almost every screen. What it does have is a large, working management suite (courses, batches, timetable, tests, assignments, attendance, certificates, fees, website builder, marketplace, the Zinny team panel, privacy) with 187 test files. **The plan keeps that suite and rebuilds the layer underneath it**: who the visitor is, which brand they see, where their account lives, where their money goes and how data gets in and out.

This document maps every feature, says whether it is kept, changed or new, and puts the work in order.

## 2. Decisions already made

| Question | Decision |
|---|---|
| Direct institutes: who runs sign-up, login and payment? | The institute's own site. Zinny receives the data through an API, webhooks and a ready plugin. No Zinny widgets on their site, and Zinny does not build their site. |
| Direct institutes: where do students learn? | In Zinny's own portal and app, showing the institute's name and logo inside a Zinny shell. |
| White label: how separate? | Two price tiers. Standard runs on the shared platform. Premium is a dedicated installation with its own database. |
| Marketplace: who collects the money? | Zinny collects, keeps a commission and pays the institute. |
| Sellers without a subscription | A seller console only: recorded courses, listings, codes, buyers, sales, payouts. No batches, tests or student management until they subscribe. |
| Live classes | A built-in classroom inside the product, charged by use. Pasted Meet or Zoom links stay as a fallback. |
| White-label mobile apps | A paid add-on: the institute's own app in the stores, built from the same code. |
| Codebase | Evolve this repository. Nothing is rewritten from scratch. (My recommendation; say so if you want a separate repository.) |

## 3. The product model

### 3.1 The three ways, side by side

| | Direct | White label | Marketplace seller |
|---|---|---|---|
| Public website | The institute's own, built by anyone | On Zinny's website builder, at the institute's address (or their own site plus the connection) | A storefront page on Zinny |
| Student signs up and signs in | On the institute's site | On the institute's address, served by Zinny | On Zinny |
| Student pays | Through the institute's gateway, on its site | Through the institute's gateway, connected inside Zinny | Through Zinny's gateway |
| Brand the student sees while learning | Zinny, with the institute's name and logo | Only the institute | Zinny |
| Account belongs to | A Zinny account, linked to the institute's site account | The institute's private set of accounts | A Zinny account |
| Admin panel | Full | Full, in the institute's brand | Seller console |
| What Zinny earns | Subscription | Higher subscription, setup fee, add-ons | Commission on each sale |
| Can also sell on the marketplace | Yes | Yes, by choice | That is all they do |

### 3.2 Plans (prices and limits are the business's to set)

| Plan | For | Includes |
|---|---|---|
| Seller | Marketplace only | Seller console. No fee; commission per sale. |
| Direct | Institutes with their own website | Full admin panel, website connection, Zinny portal and app for students, marketplace selling. |
| White label | Institutes wanting their own brand | Everything in Direct, plus own address, own brand on every screen, email and document, own gateway checkout, website builder at their address. |
| White label dedicated | Large universities and groups | White label on a separate installation and database, with a service agreement. |

Add-ons charged by use or as extras: live classroom minutes, video storage and streaming, SMS and WhatsApp credits, seat packs (exists), branded mobile app, extra web addresses.

Moving up is always possible: Seller to Direct to White label to Dedicated, with data carried over.

### 3.3 People

- **Zinny team**: Super Admin, Account Manager, Finance Admin, Support Agent, Content QA (exist); Integration Engineer and Marketplace Manager (new).
- **Institute**: Institute Admin, Board or Owner, Accounts and Fees, HOD, permanent and visiting faculty, custom roles (exist); Seller Admin for seller-only institutes (new).
- **Learners**: student, alumni, parent, marketplace learner (exist).
- **Outside systems**: an institute's website, acting through an API key (new). Everything it does is logged under its own name.

### 3.4 Stage labels used below

Phase 1 is the web platform; phase 2 is mobile. Section 7 gives the order and what runs in parallel.

| Stage | Name |
|---|---|
| 1A | Foundation |
| 1B | Direct channel (the website connection) |
| 1C | White label on the shared platform |
| 1D | Marketplace with collection and payouts |
| 1E | Live classroom and video |
| 1F | Zinny's own billing, plan enforcement, team panel |
| 1G | Completing the suite (fees, admissions, parents, community, marketing) |
| 1H | Dedicated installations |
| 1I | Hardening, migration and launch |
| 2A to 2D | Mobile apps |

## 4. Where we start from

**Works today and is kept** (detail in `docs/report/features-institute.md` and `docs/report/features-platform.md`): roles and permissions with custom roles; courses, batches, seat limits, clash check, automatic timetable, sections and plans, batch switching; curriculum, lessons and progress; tests and question pool; assignments and polls; attendance register and alerts; certificates with a public verify page; XP, badges, challenges, leaderboards; fee recording, invoices, GST on or off, refunds; website builder; insights and reports; notifications by email, SMS and WhatsApp; privacy (DPDP) tooling; the Zinny team panel with plans, licences, seat packs, invoices, support mode, sign in as, content review, analytics; institute self sign-up with a 3-day trial; the marketplace with recorded courses, live seats, combos, codes and a cross-institute cart.

**Missing, and blocking v2:**

| Gap | Why it matters |
|---|---|
| The institute is chosen only from the URL path; no custom web addresses | White label is impossible |
| One global account per email | A white-label student would be told their email "already has a Zinny account" |
| No way in for outside systems: no API, keys, webhooks or sign-in handoff | Direct is impossible |
| No student ID or roll number; no record of where a student or order came from | Direct needs both |
| One Razorpay account for everything; no commission, no payouts | Marketplace money all lands with Zinny; white label cannot use the institute's gateway |
| An institute's own students cannot pay online; only the marketplace sells | White-label sites cannot sell |
| "Zinny" is written into about 250 files; the green is hard-coded in 29 places | White label |
| Plans store modules and caps but nothing enforces them; institutes cannot pay Zinny online | The new plans cannot be sold |
| Live classes are pasted links; video is raw upload or YouTube | "Taken live inside it" |
| All logic sits behind web pages; sign-in is cookie only | Mobile apps have nothing to talk to |
| Only the daily job is scheduled; the build rules and the code have drifted apart (modules import each other, the ownership check cannot run, docs say Next 15 but the app runs Next 16) | Parallel building is unsafe until repaired |

## 5. What changes underneath (stage 1A)

Eight changes to the core carry everything else. They were checked against the code by a separate review; file references are where the work lands.

### 5.1 The web address decides the site

- New core table `tenant_domains` (address, institute, purpose, primary flag, status, verification). `universities` gains `mode` (shared, direct, white label, marketplace only) and `identity_mode` (shared or private).
- `src/proxy.ts` looks up the address and rewrites an institute's address onto the existing `/[uni]/…` and `/site/[uni]/…` pages. The 165 pages are not restructured.
- On an institute's address: `/` and site pages go to `/site/<slug>/…`; `/learn`, `/admin`, `/profile` go to `/<slug>/…`; sign-in pages pass through; `/platform`, `/marketplace` and other institutes return not found; old slug links redirect once to the short form, so existing links keep working while modules convert.
- New `src/server/site/` with `resolveHost`, `siteContext`, `links(university)` and `originFor(universityId)`. It replaces three separate `appUrl()` helpers (`src/server/auth/config.ts:84`, payments and notifications `config.ts`). `spaceContext` (`src/server/context.ts:81`) refuses an institute that does not match the address.
- The proxy's security work must run on the rewritten path: page security policy (`src/server/security/csp.ts`), the cross-site write exemptions (`src/server/security/origin.ts`), frame headers and icons. Strict transport headers must not claim an institute's other subdomains.
- An institute's public pages are cached by slug, so their links come from the institute's primary address, not from the request. Changing the primary address clears that cache (`src/modules/website-builder/cached.ts`).

### 5.2 Accounts live in sets

- `users` gains `realm_university_id` (empty means the Zinny set), `email_verified_at`, `phone_verified_at`. Email becomes unique inside a set, replacing `users_email_lower_uq` (`src/db/schema.ts:129`).
- The set follows the institute's `identity_mode`, fixed when the institute is created. White label is private; Direct and Marketplace use the Zinny set.
- A private-set session is treated as limited to its institute, reusing the existing scope mechanism for phone sessions (`src/server/auth/session.ts`, `src/server/actor.ts:53-56`, `src/server/context.ts:88`). A database rule stops such a user holding a role anywhere else.
- `zinny_upsert_user` (`src/db/policies.sql:204-216`) works out the set itself and never takes it from the app.
- Every email lookup gains the set filter: sign-up, sign-in and reset in `src/modules/identity/auth.ts`, `src/server/services/core-api.ts:244,353`, `support.ts:88`, the team panel's institute and team services, and four in-institute lookups. Sign-in throttles are keyed per set.
- Direct students stay in the Zinny set, linked by `external_identities`. Three guards: data sent by a site never edits an existing account (it lives on the student record); a handoff session cannot read or change account-wide details (`src/modules/identity/profile.ts` needs scope checks); widening a session needs a code or password.

### 5.3 A student record per institute

- New core tables `students` (student ID, contact details as the institute holds them, source, site ID, status, custom fields), `student_no_counters` (same pattern as `invoice_counters`) and `external_identities`.
- Created inside `ensureStudentRoleTx` and `admitStudentTx` (`src/server/services/students.ts:46,78`), with a backfill for today's students. New events `student.created` and `student.updated`.
- `orders` gains `channel`, `gateway_account_id` and `external_ref`. A new core function `recordExternalOrder` records a purchase paid elsewhere: no Zinny invoice unless the institute asks, and a full batch still admits the student and flags it, because the money is already taken.

### 5.4 A front door for outside systems

- Core: `api_keys`, `api_idempotency`, and a small kit in `src/server/api/` (key check, error format, validation, database-backed rate limits from `src/server/auth/throttle.ts`).
- One route, `src/app/api/v1/[...path]/route.ts`, hands calls to modules through a new `apiRoutes` slot in `src/contracts/module.ts`. Modules add endpoints without touching the app folder.
- New module `connect` (tables prefixed `conn_`): connections, product maps, incoming payloads (this is the Arrivals queue), webhook addresses, deliveries, handoff tokens.
- Outgoing webhooks are queued by an event handler and sent by a job, never from inside a database transaction (`src/server/events-drain.ts`). Payloads go through a versioned public format, not the internal event shapes.
- Test mode is a separate sandbox institute per customer, not a flag on every table.
- Pages cannot be embedded in another site's frame; the developer guide says so.

### 5.5 Money per institute

- `gateway()` (`src/server/payments/gateway.ts`) is one shared gateway today. It becomes `gatewayFor(universityId, purpose)`, and `startGatewayOrder` (`src/server/services/enrolment.ts` near line 256) records which account took the payment.
- The gateway contract (`src/contracts/payments.ts`) gains optional split transfers. Webhooks become per account at `/api/payments/razorpay/[accountId]`.
- New `src/server/security/secrets.ts` encrypts stored keys.
- `holdSeat` (`enrolment.ts:270`) makes an institute's courses free for its own students without exception. It gains a per-institute rule so white-label sites can charge.
- Payments module tables: `pay_gateway_accounts`, `pay_linked_accounts`, `pay_transfers`, `pay_ledger`, `pay_payouts`. The existing `pay_bundles` (one payment, several sellers) already fits split payments.

### 5.6 One source for the brand

- `brand(university)` returns the mode (Zinny, Zinny with the institute's name, or white label) with name, logos, colours, sender, legal links and address. `universities.branding` is extended.
- Colours need no change to page classes: the tokens in `src/app/globals.css` compile to variables, so each institute's layout sets them once. The shade and contrast helpers in `src/modules/website-builder/branding.ts` move to `src/server/brand/`.
- Fixed by hand: 22 files with the green written in, `Logo` (`src/components/ui.tsx:16-30`), the page title template (`src/app/layout.tsx:8`), identity emails (`src/modules/identity/emails.ts`), and the single sender address (`src/modules/notifications-delivery/config.ts:24`).
- A lint rule fails on the literal "Zinny" in text shown to an institute's people. It starts from today's count and only allows the number to fall.

### 5.7 Plans that are enforced

- A core `entitlements(universityId)` contract, supplied by the team panel from `plat_licences`. Read by the menu (`src/server/authz/menu.ts`), the slot registry (`src/server/registry.ts`) and the add-person and admit paths.

### 5.8 An API the apps can use

- `apiContext(request)` is the JSON twin of `spaceContext`: it returns the actor, institute and session, and raises errors instead of redirecting. `loadActor` takes the session explicitly, because today it reads the cookie and would drop the institute limit for a token.
- `sessions` gains a kind (web or app); a refresh-token table with rotation; `app_devices` for push.
- Most services already take an `Actor` and can be called directly. A few flows live in page actions and move into services first: `src/app/login/actions.ts`, `src/app/[uni]/admin/actions.ts`, `src/modules/marketplace/actions.ts`, `src/server/services/roles.ts`.

### 5.9 Repairs before anyone builds in parallel

- `CLAUDE.md` says Next.js 15; the app runs 16.4.5.
- `scripts/check-ownership.ts` compares against a tag that does not exist. Tag `v2-foundation` at the end of 1A.
- `docs/plan/ownership.json`: remove core files from the privacy entry, fix the double owner of `src/app/signup/`, fix the marketplace route, add briefs in `.claude/agents/` for marketplace, onboarding, privacy and the new modules.
- `docs/plan/contracts.md`: add the missing prefixes, module IDs, events and core API entries.
- Module boundaries: add import rules to `eslint.config.mjs` starting from today's violations (marketplace, onboarding, identity, privacy and five core files import across modules), and move session and throttle tables into core.
- The admin and learner layouts get slots for banners and account links, so new modules do not edit them.
- `vercel.json` schedules the minute and hour jobs and the event drain. The job runner (`src/server/jobs-runner.ts`) stops looping over every institute one at a time.

## 8. Order of work

The repository's existing method stays: one agent prepares the base alone, module agents then build in parallel in their own worktrees, and an integrator merges each wave.

**Stage 1A: foundation (alone, nothing else runs)**

1. Repairs from 5.9.
2. Schema for 5.1 to 5.8 and the database rules.
3. Address lookup and rewrite; account sets; brand source; `gatewayFor` and key encryption; the API kit and `apiRoutes` slot; entitlements contract; layout slots; new events and permissions; job schedules.
4. Tag `v2-foundation`.

**Wave 1 (parallel, after 1A).** The direct channel leads.

| Agent | Tables | Work | Stage |
|---|---|---|---|
| connect (new) | `conn_` | API endpoints, product mapping, placement, handoff, webhooks, sync monitor, Arrivals, test mode | 1B |
| identity | `idn_` | Sign-in per account set, handoff sessions, first-visit flow, credential tools, app tokens | 1B, 1C |
| students screens (core) | core | Student ID format, ID cards, source filters, timeline | 1B |
| domains (new) | `dom_` | Address setup, verification, certificates, neutral fallback | 1C |
| branding (new) | `brand_` | Brand studio, assets, email domains, previews | 1C |
| payments | `pay_` | Institute gateway accounts, per-account webhooks, paid checkout for own students | 1C |
| notifications-delivery | `notif_` | Brand-aware templates, per-institute sender, new message kinds | 1C |
| zinny-team-panel and onboarding | `plat_`, `onb_` | Entitlements, new plan types, online payment to Zinny, Integration desk | 1F |
| every existing module | own | Convert its own links and Zinny wording | 1C |

**Wave 2 (parallel)**

| Agent | Work | Stage |
|---|---|---|
| WordPress plugin (own folder outside `src/`), then the gateway listener | Connectors | 1B |
| marketplace and payments | Seller sign-up, split payments, ledger, payouts, refunds with reversal, reviews, categories | 1D |
| classroom (new, `room_`) and content-progress | Built-in classroom, recordings, video pipeline | 1E |
| website-builder | Extra pages, SEO, tags, root sitemap at the institute's address | 1C |
| developer site | Guides and API reference | 1B |
| app API (new, `app_`) | Screen data functions, devices, push | 2A, started early |

**Wave 3 (parallel)**

| Agent | Work | Stage |
|---|---|---|
| fees, admissions, parents, community, marketing | 6.6 and 6.7 additions | 1G |
| dedicated | Single-institute mode, licence link, support tokens, move tool | 1H |
| integrator and security | Full click-through, load test, outside security test, migration of today's institutes | 1I |

**Then phase 2**: stages 2A to 2D from section 7.

**First customer milestone**: one real direct institute live on the website connection at the end of wave 1 plus the plugin, before white label and the marketplace changes finish.

## 11. Risks

| Risk | How the plan handles it |
|---|---|
| Changing how accounts work breaks sign-in for everyone | Done alone in the foundation stage, behind the existing 187 test files plus new account-separation tests, before any parallel work starts |
| Each coaching site is built differently, so integrations drag on | Three connection types from day one, a no-developer option, a test mode, and the playbook above |
| A site sends wrong or duplicate data | Idempotent writes, the site's own IDs as the key, duplicates list, reconciliation, replay |
| Marketplace tax and licensing rules are misjudged | Sign-offs listed in section 10 are gates for 1D, not afterthoughts |
| The Zinny name leaks into a white-label surface | One brand source, an automated check that fails the build on a stray "Zinny", and a screenshot sweep of every surface under a test brand |
| Video costs outrun what institutes pay | Minutes and storage counted from the first day and sold as add-ons; limits per plan |
| Dedicated installations multiply release work | Same code, set by configuration; released on a schedule after the shared platform; built last |
| Mobile apps stall on missing server features | The app API and token sign-in start in the foundation stage |
| Parallel agents collide | Ownership rules and contracts repaired first; one agent per module; an integrator merges each wave |

## 12. How each stage is checked

- **Every stage**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:ownership`; an isolation test for every new table; an allow and a deny test for every permission; screenshots in `docs/handoff/`.
- **1A**: all existing tests still pass; a test brand on a second local address shows no Zinny name on sign-in; two accounts with the same email in different account sets sign in separately; a call with an API key reads a course list.
- **1B**: a sample WordPress site in a container sends a sign-up and a paid order; the student appears in Arrivals with an ID; the handoff link signs them in to that institute only; replaying the same order changes nothing; a webhook reaches a test receiver and verifies.
- **1C**: a Playwright sweep of every surface under a test brand and address, failing on the word "Zinny"; a paid checkout through a test gateway account that belongs to the institute.
- **1D**: a seller-only institute signs up, lists a course, a buyer pays in gateway test mode, the ledger shows the split, a refund reverses it, and the daily match against the gateway's settlement balances.
- **1E**: two browsers join a class, attendance is recorded from presence, the recording appears as a lesson.
- **1F**: an institute pays a Zinny invoice in gateway test mode; a module outside the plan is hidden and refused on the server; adding a student over the cap is blocked after the grace period.
- **1I**: load test on the API and sign-in; outside security test; a dry run of moving today's institutes to the new plans.
- **Phase 2**: the same flows on a low-end Android phone and an iPhone, including offline and push; beta through TestFlight and Play internal testing.

