# platform handoff

The Zinny team panel (/platform): plans as data, licences that invoice, revisable invoices, set anyone's password, and sign in as any account. Screenshots are in `docs/handoff/platform/` (desktop 1440 at 2x; the learner banner also at 390 px).

## Built

- **Plans** (`/platform/plans`, `/platform/plans/[id]`): `plat_plans` table; list with price, period, caps, modules and institutes on each; create, edit, archive, restore. Pilot, Standard and Enterprise are inserted by `ensureDefaultPlans()` the first time an empty table is read (and by the seed). Viewing needs `platform.licences`; changing needs Super Admin. The hard-coded `PLANS`, `PLAN_LABELS` and `PLAN_DEFAULTS` are gone.
- **A licence charges the institute**: the licence stores `price_paise` (copied from the plan), `discount_paise`, `discount_note`. Creating an institute with a licence, setting one up, renewing it (the term changes) or moving it to another plan raises an invoice in the same transaction for (price − discount) + GST. The form shows list price, discount and note, net, GST, total, invoice date and due date before saving. "Don't create an invoice" skips it; a net of 0 never invoices. The licence page lists the invoices raised for it.
- **Invoice revision** (`/platform/billing/[id]`): while unpaid, change amount, discount and note, description, period, invoice date and due date. GST and total are recomputed at the invoice's own rate and state split; the number never changes; paid invoices are locked until marked unpaid. Each revision is audited with before and after values and shown in a history card.
- **Set password**: on a person's page, the institute page and the support page. Uses `checkNewPassword` and bcrypt hashing; "Sign them out everywhere" is on by default. Logged as `plat.password.set` in the platform log and each of the person's institutes. A new institute's first admin can be given a password on the create form.
- **People**: the list now finds every account (institute people, the Zinny team, and accounts with no role), and an institute's people are listed on its page.
- **Sign in as**: a real session for the target with `sessions.impersonator_user_id`, 2 hours, never extended. The Super Admin's own token is kept in a second cookie (`zinny_return`, `__Host-zinny_return` in production; httpOnly, SameSite=Strict, Secure in production). A gold banner on the admin, learner, marketplace and platform layouts has "Return to the Zinny panel". Signing out while signed in as someone returns too. Start and stop are logged in the platform log and the target's institutes; every audited write in between carries `data.impersonatedBy` and shows as "Asha Admin, by Zara Zinny (Zinny)" in the activity log and its CSV.
- "View as student" is kept and relabelled "View as, read only".

## Not built (and why)

- No print, PDF or CSV output of Zinny invoices existed, so none was changed. The invoice page and list show list price, discount and net.
- The institute's own audit-log screen (outside this stream's files) does not yet render `impersonatedBy`; the data is in every row.
- The invitation email still goes out when a first admin is given a password directly (core `createUniversity` sends it). The link then says the account already has a password.

## Contracts used / provided

- Core API: `createUniversity`, `updateUniversity`, `audit`, `assertPlatform`, `canPlatform`, `loadActor`.
- `Actor.impersonatedBy?: { userId; name }` (additive). `audit()` adds it to `data` when set.
- `loadActor(userId, universityId, opts?: { session })`: third argument is optional; without it the request's session is read.
- `ResolvedSession` gained `impersonatorUserId: string | null`. New `sessionFromCookies(jar)`.
- New: `src/server/auth/impersonation.ts` (`beginImpersonation`, `endImpersonation`, `isActiveSuperAdmin`), `src/server/auth/admin.ts` (`storePasswordFor`).

## New packages

None.

## New environment variables

None.

## Requests for other owners

- Identity/core: show `data.impersonatedBy` in the institute's own audit-log screen.
- Core: `createUniversity` could take "don't send the invitation" for when a password is set directly.
- Integrator, when generating the migration: `plat_licences.plan` goes from the `plat_plan` enum to `text` (`alter column plan type text using plan::text`, then drop the type). `plat_invoices.list_price_paise` is nullable so existing rows need no backfill; it can be backfilled with `base_paise + discount_paise` and made not null.

## Known issues

- `sessions.impersonator_user_id` is "on delete set null" as specified. A session whose impersonator is cleared is still refused, because `idn_sessions.method = 'impersonation'` marks it; `resolveSession` deletes it.
- The banner is fixed to the bottom of the window (above the tab bar on phones), so it can cover the last line of a page until you scroll.
- Tests that fail on the base commit too, untouched here: `tests/core/core-api.test.ts` (facade export list), `tests/core/focus-mode.test.ts` (learner tab bar marker), `tests/zinny-team-panel/records.test.ts` (wording of "already has that role"). `tests/core/suspended.test.ts` was failing on base (cookies read outside a request) and now passes.
