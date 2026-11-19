# onboarding handoff

Module `src/modules/onboarding` (prefix `onb_`): institute self sign-up with a free 3-day trial, document review, the trial freeze and plan checkout, and student KYC. Screenshots are in `docs/handoff/onboarding/`.

## Built

- **`/signup`** now offers two choices: "Sign up as institute" (goes to `/signup/institute`) and "Sign up as student" (goes to `/signup?as=student`). The existing student flows are unchanged behind the student choice: the marketplace account, `?code=`, `?uni=`, `?join=1` and `/signup/phone`. The institute card grows into the wizard page through a shared view transition.
- **Institute self sign-up** at `/signup/institute`. `/book-a-demo` shows the same wizard, with a small "Prefer a call first?" fold-out that holds the existing demo-request form, now labelled "Request a call". The wizard has four steps, and each "Continue" asks the server to check the steps so far:
  1. Institute: name, legal name, type, city, state (with its GST state code), address and web address (the slug, filled in from the name and checked for clashes).
  2. Your account: contact person, email, mobile number, password and confirmation.
  3. GST: "When you sell a course, does GST apply to your institute?" Yes or No, with a GSTIN when Yes. The GSTIN format is checked and must match the chosen state. The answer is saved to `universities.gstEnabled` and `gstin`.
  4. Documents: the PAN card is required. Partnership deed, MOA, AOA, GST certificate and licence/registration are optional. Files are dragged in or chosen, as PDF, JPG or PNG up to 10 MB, with Replace and Remove. Type and size are checked in the browser, and the bytes are checked again on the server.
  - "Start my free 3-day trial" calls `createSelfServeUniversity` in the core API. That creates the university, its Institute Admin and `trialEndsAt` = today + 3 in the university's time zone. The action then signs the admin in and sets the institute cookie. The files upload in 3 MB parts through `/[uni]/admin/choose-plan/documents/upload`, and the admin lands on `/[uni]/admin/choose-plan/documents?welcome=1`.
  - Documents go in `onb_documents` with university, kind, storage key, status (uploading, pending, approved or rejected), the reviewer's note and who reviewed it. Replacing or removing one keeps the old row with `superseded_at` set, so nothing is deleted. The PAN card can be replaced but not removed. The institute can upload, replace, open or remove its documents later at `/[uni]/admin/choose-plan/documents`.
  - The onboarding pages now use a minimal `OnboardingShell` (logo, a sign-in link and the task), not the landing page's marketing nav and footer. I couldn't find the "digital marketing" text in the onboarding code. It is the demo university's seeded "Digital Marketing" course, which the landing page and marketplace show. Those sections are gone from the onboarding pages.
- **Trial and freeze**
  - `src/modules/onboarding/components/trial-banner.tsx` exports the server component `<TrialBanner uni actor />`. It shows the days left and a "Choose a plan" button to people with `settings.manage` during a trial, and renders nothing otherwise.
  - The job `onboarding.trial-freeze` runs hourly in `index.ts`, as each university's system actor. When today (in the university's time zone) is on or after `trialEndsAt` and no licence covers today, it sets the status to "frozen" through core `setTrialState`, which audits it. It is idempotent, ignores institutes the Zinny team set up (`trialEndsAt` null) and never deletes anything.
  - `context.ts` sends a frozen university's people as follows. Admins with `settings.manage` go to `/{uni}/admin/choose-plan`, and can open only that page and its `/documents` page. Everyone else goes to `/frozen?uni=…`. Support mode, view-as and impersonation still get in, the same as for a suspended university.
  - `/[uni]/admin/choose-plan` lists the plans from the zinny-team-panel's `allPlans`, with prices before and with GST. It needs a usable PAN card. Payment goes through the core gateway (the mock gateway in test mode). After payment it calls `saveLicence` and `markInvoicePaid` from zinny-team-panel, as a narrow "Zinny checkout" system actor, records the order in `onb_plan_orders` and sets the status back to active.
- **`/platform/signups`** (needs `platform.manage_universities`) lists self-signed institutes with their status, trial end and days left, contact details, GST and documents. The team can open each file, approve or reject it with a note (a rejection must have one) and extend a trial by 1 to 60 days, which also unfreezes a frozen institute. Every write is audited in the institute's audit log under the reviewer's name.
- **Student KYC** at `/[uni]/learn/kyc`, built mobile first and checked at 390 px.
  - The PAN must match `AAAAA9999A`. It is stored encrypted with AES-256-GCM and a fresh IV per value, using `KYC_ENCRYPTION_KEY` (the dev fallback key is refused in production), and it is shown only masked as `XXXXX1234F`.
  - The Aadhaar field takes the last 4 digits only. A full number is refused in the browser and on the server, and it is never stored or logged.
  - A consent checkbox is required, and its time and the notice version are stored.
  - KYC is optional. The learner home card "Complete your KYC" shows until it is done.
- **Seed** adds three things:
  - Sunrise Academy (`/sunrise-academy`, admin anita@sunrise-academy.in): in its trial, with a pending PAN card and GST certificate.
  - Lakeview Coaching (`/lakeview-coaching`, admin farhan@lakeview-coaching.in): frozen.
  - Riya (riya@demo.edu): KYC completed at the Demo University.
  - Every account uses the password `zinny123`.
- **GST check.** These paths honour `gstEnabled`:
  - core `orderGst` for every order hold (`holdRecordedSeat`, `holdMarketplaceSeat`)
  - core `issueInvoice` (no GSTIN and no tax when GST is off)
  - marketplace listing and cart prices (`case when gst_enabled`)
  - the website-builder public checkout
  - payments manual invoices (`gstApplied`)
  - offline fee payments (`fees.ts`)
  - The only loose end: `marketplace/cart.ts` falls back to an 1800 bp rate when a course's rate can't be found, though the query normally finds it. Zinny's own plan invoices always charge GST, because Zinny is the seller there.

## Not built (and why)

- **Rendering the trial banner in the admin layout.** The admin layout isn't mine. The lead adds `<TrialBanner uni={uni} actor={actor} />`.
- **Nav links to `/platform/signups` and to the institute's Documents page.** The platform nav and admin nav aren't mine.
- **Real Razorpay for plan purchases.** With the real gateway, choose-plan says online payment isn't switched on and asks the institute to contact the Zinny team. `confirmPlanPayment` is ready for a webhook to call.
- **Emails** to the institute when a document is rejected or the trial is about to end. No notification kinds exist for these yet.

## Contracts used / provided

- **Job:** `onboarding.trial-freeze`, hourly.
- **Slot:** `learnerHomeCards` key `kyc` (the "Complete your KYC" card).
- **Core API used:** `createSelfServeUniversity` and `setTrialState` (new in `src/server/services/core-api.ts`), `withTenant`, `audit`, `assertCan`, `assertPlatform`, `storage()`, `gateway()`, `todayIn`, `loadActor`, `systemActorFor`, `universityBySlug`, `startSession`.
- **zinny-team-panel exports used:** `allPlans`, `licenceFor`, `saveLicence`, `markInvoicePaid`, `gstFor`, `checkSlug`, `universityOptions`.
- **Minimal core edits, as briefed:**
  - `universities.trialEndsAt` (a nullable date)
  - status "frozen" and the trial fields in `core-api.ts`
  - the frozen redirect in `context.ts` (`frozenRedirect`, using the route Next is rendering)

## New packages

None.

## New environment variables   (also in src/modules/onboarding/ENV.md)

- `KYC_ENCRYPTION_KEY`: 32 bytes, as 64 hex or 44 base64 characters. It is required in production. Development and tests use a built-in key.

## Requests for other owners

- **Integrator / contracts:**
  - Add `"onboarding"` to `MODULE_IDS` in `src/contracts/module.ts`, then drop the `as ModuleId` cast in `index.ts`.
  - Storage keys must start with a module id, so documents are stored under `<uni>/zinny-team-panel/onboarding/…` (`STORAGE_AREA` in `services/documents.ts`). Switch that to `onboarding` once it is listed; stored keys are kept on each row, so old files still open.
  - Add an `onboarding` agent to `scripts/check-ownership.ts`. `npm run check:ownership` stops with "Unknown agent onboarding".
  - Generate the migration for the `onb_` tables and `universities.trial_ends_at`.
- **Lead (admin layout):**
  - Render `<TrialBanner uni={uni} actor={actor} />` at the top of `src/app/[uni]/admin/layout.tsx`.
  - Add a "Documents" item for `settings.manage` that points to `/{uni}/admin/choose-plan/documents`.
- **zinny-team-panel:**
  - Add "Self sign-ups" (`/platform/signups`, `platform.manage_universities`) to the platform nav.
  - Optionally show trial status on the institutes list.
- **identity:**
  - The learner profile could link to `/{uni}/learn/kyc`.
  - The AuthShell's "Run an institute? Book a demo" could read "Start a free trial".

## Known issues

- The Next dev server sometimes aborts the first server action after a fresh compile with "Unexpected end of JSON input". A second click works. Production isn't affected.
- `frozenRedirect` reads the current route from Next's `workAsyncStorage`, an internal API. If Next stops providing it, a frozen admin is let in rather than looped.
- The freeze happens on the trial's end date, so "ends on 23 Nov" means paused from that day. The trial banner says "ends today" on that day.
- Full `npm test` gives 1685 passed and 5 failed, and all 47 onboarding tests pass. One failure comes from this module: `tests/core/slots.test.tsx` ("generated registry holds the twelve modules") fails because the registry now has `onboarding`, which `MODULE_IDS` doesn't list yet. It passes once the integrator adds `onboarding` to `MODULE_IDS`. These four were already failing on the base branch and are unrelated to onboarding:
  - `tests/core/core-api.test.ts` (facade export list)
  - `tests/core/focus-mode.test.ts` (`data-learn-chrome`)
  - `tests/reports-board/insights.test.ts` ("university" vs "institute" copy)
  - `tests/zinny-team-panel/records.test.ts` (error copy)
