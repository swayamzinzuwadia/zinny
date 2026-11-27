# privacy handoff

DPDP Act 2023 and DPDP Rules 2025 for Zinny. Module `src/modules/privacy/` (prefix `dpdp_`). The obligation-by-obligation map, with the gaps that need legal or process work, is in `docs/compliance/dpdp.md`. Screenshots are in `docs/handoff/privacy/`, with learner screens at 390 px.

The branch starts from `claude/zini-platform-updates-pzxloz` (fast-forwarded), because the onboarding module, KYC and institute sign-up this work builds on only exist there.

## Built

- **Privacy notice** at `/privacy`, version `2026-11.1` (`lib/rules.ts` `NOTICE_VERSION`). It covers:
  - who the Fiduciary is (the institute for its learners; Zinny for marketplace learners and sign-ups);
  - every kind of data, itemised with its purpose and retention (`lib/notice.ts`);
  - consent and how to withdraw it, each right, children, cookies, retention, sharing and breaches;
  - the grievance officer (`#grievance`, set through `PRIVACY_GRIEVANCE_*`), the right to complain to the Board, and other languages.
  - A Hindi version of the essentials is at `?lang=hi`. Act s.5, Rules 3 and 9.
- **Consent records** in `dpdp_consents`, one row per purpose (`account`, `service`, `kyc`, `marketing`, `analytics`, `guardian`). Each row holds the notice version, granted and withdrawn times, the source, and a salted SHA-256 IP hash. `university_id` is null for Zinny's own records. Consents are recorded:
  - **Institute sign-up:** three boxes on the wizard's last step. Account and service are required; news is optional and unticked. Recorded by `startTrialAction`.
  - **Student sign-up** (marketplace, joining code and institute link): the same three boxes plus an age question. They are recorded for Zinny and, when joining, for the institute too.
  - **KYC:** the existing KYC consent is also recorded on the institute's consent record.
  - Withdrawing is one tap. Account and service can only end through erasure. Act s.6.
- **Cookie banner** (`components/cookie-banner.tsx`, mounted in `src/app/layout.tsx`):
  - shows on public pages only, with essential cookies only by default and an analytics switch;
  - remembers the choice for 180 days in `zinny_cookies`, and can be reopened from `/privacy#cookies`;
  - rises in and sinks out, with no motion under reduced-motion.
- **Rights pages:** `/[uni]/profile/privacy` covers the institute's records; `/privacy/my` covers Zinny's own (marketplace learners) and links to each institute's page. On both, a person can:
  - see and withdraw consents, or switch news and analytics on;
  - download their data as JSON (profile, roles, enrolments, orders and invoices, KYC with the PAN masked, consents, requests). Each download is logged as a completed `access` request;
  - ask for correction or erasure, name a nominee, or make a complaint. Requests go into `dpdp_requests` with a status and an SLA due date: correction and nominee 15 days, erasure and grievance 30, against the 90-day ceiling in Rule 14(3).
- **Handling requests:**
  - **Institute admin** (`/[uni]/admin/settings/privacy`, permission `privacy.manage`) has tabs for Requests, Consents, Retention and Data processing (Zinny as Processor, s.8(2)).
  - **Zinny team** (`/platform/privacy`, permission `platform.manage_universities`): answers Zinny's own requests and sees every institute's queue, with overdue counts.
  - **Erasure** does the following:
    - anonymises name, email, phone and password, unless the same sign-in still holds a role at another institute;
    - deletes the KYC row, withdraws consents, ends the person's roles there, and signs them out everywhere;
    - keeps GST invoices (8 years) and the consent and request log, and the reply tells the person so.
  - Every action is audited (`privacy.*` actions in `audit_log`).
- **Children** (s.9, Rule 10). Zinny stored no date of birth anywhere, so:
  - student sign-up and the privacy page now ask whether the learner is 18 or older, with an optional date of birth;
  - for an under-18 learner, the guardian's name and email or mobile are taken, and a 7-day link is sent (`/privacy/guardian/[token]`, stored only as a hash);
  - the guardian reads what is processed and confirms, which records a `guardian` consent;
  - until then, optional purposes are refused, `trackingAllowed(userId)` returns false, and a gold card on the learner home says the app is waiting for the parent.
- **Breach register** at `/platform/privacy/breaches`:
  - log an incident (detected and occurred times in IST, data kinds, people affected, institutes, measures);
  - record the first intimation to the Board, the detailed report, and the notice to people, with live 72-hour countdowns (gold under 24 h, red when overdue);
  - mark it contained or closed. Closing needs the report and the notices first. Rule 7.
- **Retention.** Each institute sets a period (default 3 years, from 6 to 120 months) and an action: flag, or anonymise. The daily job `privacy.retention`:
  - flags learners inactive past the period and tells them by notification and email;
  - anonymises only 48 hours or more after flagging (Rule 8(2)), and clears the flag if they come back.
  - Admins can keep a flagged account or anonymise it from the Retention tab.
  - Consents and requests are never deleted (Rule 8(3)). Each institute can also set its own grievance contact.
- **Also added:**
  - a "Privacy requests" row in the dashboard's "Needs you" list;
  - a Settings → Privacy menu item;
  - a Privacy section in the platform nav.
- **Seed:** consents for the 12 Demo students (5 with news on, Kabir's withdrawn, KYC consents for Riya and Aditi), Zinny-level consents for Neha (marketplace). It also adds:
  - an open erasure request from Rohan and an in-progress correction from Meera;
  - a nominee request from Neha;
  - Tara as a minor waiting for her guardian;
  - retention settings, and one closed breach handled within 72 hours.
- **Tests** in `tests/privacy/` (6 files, 41 tests):
  - isolation for all 5 tenant tables;
  - consent grant and withdraw, plus sign-up and KYC recording;
  - the export has the masked PAN and never the PAN;
  - erasure anonymises but keeps invoices, and keeps the sign-in when the person belongs to another institute;
  - a minor is blocked until the guardian confirms, and an expired link does nothing;
  - allow and deny for `privacy.manage` and the platform permission, plus the retention job;
  - breach deadline maths, due dates, age and retention maths.

## Not built (and why)

- **Consent manager integration** (Rule 4): there are no registered consent managers to integrate with yet. Listed as a process decision.
- **Identity-backed verification of guardians** (DigiLocker or a virtual token, Rule 10(1)): the email or SMS link the guardian controls is our verification. Rule 11 (lawful guardians of persons with disabilities) is not built.
- **A nominee acting in the app:** a nomination is recorded as a request; the nominee contacts the grievance officer.
- **Full Hindi translation:** only the essentials are in Hindi. Other Eighth Schedule languages are available on request.
- **Sending breach notices:** the register tracks the Board and people notices; a person sends them.

## Contracts used / provided

- **Core API:** `withTenant`, `audit`, `assertCan`, `assertPlatform`, `canPlatform`, `todayFor`, `todayIn`, `loadActor`, `notify`, `sendEmail`, `sendSms`.
- **Slots:**
  - `learnerHomeCards` with key `guardian-consent` (order 40, `self.profile`);
  - `dashboardCards` with key `privacy-requests` (order 90, `privacy.manage`, `needsYou` only).
- **Jobs:** `privacy.retention` (daily).
- **No events emitted or handled:** the catalogue is frozen and has nothing for privacy.
- **New permission:** `privacy.manage`. Institute Admin gets it through `ADMIN_ALL`; there is an ability row "Handle privacy requests" under Settings.
- **System connection** (`services/system.ts`, the only file that uses it). It is used only for:
  - Zinny-level rows (`university_id` null, which row-level security hides from every tenant) and the breach register (no university column);
  - the signed-in person's own rows (filtered by user id);
  - a guardian link looked up by its token hash;
  - the Zinny team after `assertPlatform`.
  - This is the same pattern as marketplace and zinny-team-panel. It needs the integrator's sign-off as a named exception.
- **Outside-ownership edits**, as the brief allowed:
  - `src/app/layout.tsx` (the banner);
  - `src/app/signup/**`, including a new `student-signup.tsx` and `actions.ts`;
  - `src/modules/onboarding/components/institute-signup.tsx`, where the consent boxes are added and `start()` now also takes `consents`;
  - `src/app/[uni]/learn/kyc/actions.ts` (a two-line consent record);
  - `src/server/authz/{roles,abilities,menu}.ts` and `tests/authz.test.ts`;
  - `src/modules/zinny-team-panel/lib/access.ts` and the nav key lists in `tests/zinny-team-panel/permissions.test.ts`, which had to change when a nav section was added;
  - `src/contracts/module.ts` (`MODULE_IDS`) and `docs/plan/ownership.json`.

## New packages

None.

## New environment variables   (also in src/modules/privacy/ENV.md)

- `PRIVACY_IP_SALT`: salt for consent IP hashes. Set it in production.
- `PRIVACY_GRIEVANCE_NAME` and `PRIVACY_GRIEVANCE_EMAIL`: the grievance officer on the notice. Set them in production.
- `PRIVACY_GRIEVANCE_PHONE` and `PRIVACY_GRIEVANCE_ADDRESS`: optional.

## Requests for other owners

- **Core:**
  - an `anonymiseUser(tx, actor, userId)` core API, and an event such as `privacy.erasure_completed` `{ userId }` so modules purge their own personal fields. Erasure updates `users` and `role_assignments` directly under row-level security, and deletes `onb_student_kyc` (onboarding's table), in one clearly marked file: `services/erasure.ts`;
  - a public `revokeAllSessions` or `signOutEverywhere` in the core API. The route actions call `@/server/auth/session` for now.
- **Onboarding:** handle the erasure event above for `onb_student_kyc`, and documents of sole-proprietor institutes.
- **Identity:**
  - a "Privacy" link on `/[uni]/profile` and in the learner account menu, to `/[uni]/profile/privacy` and `/privacy/my`. Today they are reached from the learner home card, the notice and the footer;
  - consider moving the student sign-up consent and age fields into `SignUpForm` itself. They currently join it through the HTML `form` attribute and a CSS `order` rule (`.dp-signup` in `components/privacy.css`);
  - erase the profile photo on the erasure event.
- **Gamification, leaderboards and content-progress:** check `trackingAllowed(userId)` from `@/modules/privacy/services/children`. Better, core could expose it as an API: XP, streaks and leaderboard ranks are behavioural monitoring of minors (s.9(3)). The learner home still shows XP for Tara.
- **Notifications-delivery and marketing:** send news only to people with a live `marketing` consent.
- **Zinny-team-panel:** an icon for the `privacy` nav section (it shows a dot, as "Data" does).

## Known issues

- In `next dev --webpack`, after any server action the page sometimes reloads fully once or twice, so the inline "Saved." message can vanish before it is read. The same happens on identity's `/[uni]/profile`, so it isn't specific to this module. The change itself is applied; the row updates (for example, Withdraw becomes Switch on).
- `npm run check:ownership` diffs against the `foundation-v1` tag, so it reports every merged change since the foundation, not only this agent's.
- Platform pages never reach Playwright's `load` event in dev. Screenshots wait for `domcontentloaded`.
- The four failures named in the brief remain, and nothing else fails:
  - core-api facade;
  - focus-mode chrome;
  - reports-board insights;
  - zinny-team-panel records invite.
