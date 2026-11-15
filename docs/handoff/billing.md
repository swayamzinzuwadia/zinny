# billing handoff

Plans, prices, licences and Zinny's invoices are now one place in the Zinny team panel, and billing runs itself: licences renew and invoice automatically, and unpaid invoices are chased on a schedule.

## Built

**Menu.** New sidebar section **Plans and billing** (`src/modules/zinny-team-panel/lib/access.ts`):

| Item | Page | Who sees it |
|---|---|---|
| Plans and prices | `/platform/plans` | platform.licences |
| Licences | `/platform/licences` | platform.licences |
| Invoices | `/platform/billing` | platform.finance |
| Billing settings | `/platform/billing/settings` | Super Admin or platform.finance |

"Institutes" now holds only Institutes; the separate "Zinny invoices" item is gone. The Overview (`/platform`) has one quiet "Plans and billing" row under Needs attention: plans on offer, renewals due in 30 days, unpaid total. Overview height at 1440 is 963 px.

**Plans and prices.** One row per plan: name and description, price and period ("₹7,20,000 for 12 months"), GST %, student and staff caps, modules, licences on it. Each row has Edit (opens `/platform/plans/[id]`) and quiet Archive/Restore/Delete links. "Add a plan" at the top opens `/platform/plans/new`. When you change the price on the edit form, a note appears: "Existing licences keep their price until they renew; renewals use the new price." Renewals really do work this way:
- automatic renewals and "Renew now" use the plan's price on the day of renewal (`renewalCharge`)
- in the licence form, "Renew for another year" and any change to the term reprice at the current plan price unless the price was typed in by hand

**Billing settings** (new table `plat_billing_settings`, one row with id `zinny`, no university_id). Settings and defaults:
- payment terms: 15 days, as before
- renewal lead time: 15 days
- new licences renew automatically: on
- keep a licence's discount on renewal: on
- payment reminders: on. Schedule: 3 days before the due date (0 turns this off), on the due date, then every 7 days, at most 3 overdue reminders

Saving is audited (`plat.billing_settings.update`, with the values before and after). `saveLicence`, the licence form and the new-invoice draft use the payment terms instead of `DEFAULT_PAYMENT_DAYS`. Super Admins get **Run billing now**, which runs the same job for every institute and reports what it did, for example "Renewed 1 licence, sent 1 reminder." The run itself is logged as `plat.billing.run`.

**Per-licence auto-renew.** New column `plat_licences.auto_renew boolean not null default true`. It shows as "Renew automatically" on the licence form, as "renews automatically / auto-renew off" in the Licences list, and as "Renews" on the licence page.

**Automation** (`services/automation.ts`; daily job `zinny-team-panel.billing`, `every: "day"`, so the Vercel daily cron runs it). Everything is idempotent.
- **Renewals.** A licence qualifies when all of these hold:
  - auto-renew is on
  - it hasn't ended yet
  - its end date is within the lead time
  - it has no invoice yet starting the day after its end date

  It is renewed through `renewLicenceTx` → `saveLicenceTx`, the same code that saves a licence by hand. The next term starts the day after the end date and runs for the plan's `billingMonths`, at the plan's current price. The discount (and its note) carries over if the settings say so. The invoice is dated today and due after the payment terms. The audit entries carry `automatic: true` with no actor, and the invoice page shows "by Zinny, automatically".

  If the plan is archived, the licence isn't renewed. It gets a `renewal_blocked` licence warning instead: "Plan X is archived; pick a plan to renew". The warning clears by itself once the plan is restored or the licence is renewed. `syncAlertsFor` now only manages its own three kinds, so the hourly check leaves this warning alone.
- **Reminders.** For each unpaid invoice, the latest step on the schedule that has come round and hasn't been sent yet:
  - the step is stored on the invoice (`reminder_stage`, `last_reminder_on`), so the same step is never sent twice, and missed steps are not sent in a pile
  - nothing is sent on the day the invoice is issued
  - changing the due date (revise) starts the schedule again

  The institute's admins get an in-app notification (core `notify`, kind `zinny.invoice_reminder`) and an email (core `sendEmail` → notifications-delivery transport; console in dev). The reminder is logged as `plat.invoice.reminder` and shows in the invoice's History as "Reminder sent … by Zinny, automatically".
- **Overdue** stays a derived state (unpaid and past the due date), as before. Suspended institutes are skipped.

**Invoices page.** "Coming up" lists licences ending in the next 60 days (capped at 8, then "See all"). Each row has:
- the end date, the plan, and when the renewal will be invoiced
- the renewal total with GST
- auto-renew state
- "Renew now" (or "Pick a plan" when the plan is archived) and "Turn off / Turn on auto-renew"

Below it, the invoice list as before. Overdue amounts are in danger text, with no pink or gold badges. Unpaid invoices show "Reminded <date>".

**Invoice page.** "Edit dates and amounts" (the old revise form), mark paid or unpaid, and a new **Open PDF** link (`/platform/billing/[id]/pdf`). The PDF is drawn with the shared GST invoice layout and isn't stored, so it always matches the invoice.

**Licence form** (from an institute's "Set up licence" or Licences):
- the plan picker shows prices ("Standard · ₹7,20,000 for 12 months") and picking a plan prefills its price
- discount with a note, invoice date and due date
- "Renew automatically"
- a live line: "An invoice for ₹3,54,000 will be issued on 15 Nov 2026, due 25 Nov 2026."

Also fixed: the fieldset caused 5 px of horizontal scroll at 390 px. The Charge box and the warnings list are now flat rows.

**Checked in the browser** (Super Admin, 1440 px). Each step in order:
- created a plan, then edited its price (the note appears)
- created an institute, then set up its licence with a ₹20,000 discount; the preview showed ₹3,54,000 and the invoice was raised
- revised the invoice's due date, marked it paid, and opened the PDF (200, application/pdf)
- set Demo Institute's licence to end in 10 days, then pressed Run billing now: "Renewed 1 licence, sent 1 reminder."
- result: the renewal invoice ZNY/…/0006 (₹53,100, Pilot, next term) and a reminder in the overdue invoice's history

No horizontal scroll at 390, 820, 1280 or 1440 on any page touched.

Screenshots in `docs/handoff/billing/`:
- `sidebar-plans-and-billing.png`
- `plans-and-prices.png`
- `plan-edit-price-note.png`
- `billing-settings.png`
- `invoices-coming-up.png`
- `invoices-after-run.png`
- `invoice-reminder-history.png`
- `licence-form-invoice-preview.png`
- `overview.png`

## Not built (and why)
- Licences that have already ended are not renewed automatically. A person renews them with "Renew now" on Invoices. Otherwise a licence that lapsed long ago would be billed for terms nobody agreed.
- The payment reminder email is plain text with the institute's branding from notifications-delivery. There is no pay link: Zinny invoices have no online payment.

## Contracts used / provided
- Core API: `notify`, `sendEmail`, `systemActorFor`, `assertPlatform`, `audit` (through `logAction`).
- Job: `zinny-team-panel.billing` (`every: "day"`).
- Notification kind `zinny.invoice_reminder`, added to the notifications-delivery catalogue as a staff kind for institute_admin. Its default email is "off" because Zinny emails the reminder directly; this stops a second copy.
- The PDF route imports `renderInvoicePdf` from `src/modules/payments/pdf/invoice-pdf.ts`. This is a pure renderer, imported in an app route, not in module code.

## New packages
None.

## New environment variables
None.

## Schema changes (db:push; all push cleanly with `--force`)
- New table `plat_billing_settings`. Every column has a default.
- `plat_licences.auto_renew boolean not null default true`
- `plat_invoices.reminder_stage integer not null default 0` and `plat_invoices.last_reminder_on date` (nullable)

## Requests for other owners
- notifications-delivery: `zinny.invoice_reminder` is in `MODULE_KINDS` with email off. `tests/notifications-delivery/module-kinds.test.ts` allows that one exception.

## Known issues
- The automation runs on the system connection, not under `withTenant`. Plans, settings and the invoice counter are Zinny-only tables that row-level security keeps from a university's connection. This is the panel's documented exception, the same as `saveLicence`.
- `npm run check:ownership` has no "billing" agent, so it can't be run for this integrator task.
- Running `db:reset` while `npm run dev` is up leaves postgres-js with stale enum array types: the institute page throws `p.roles.map is not a function`. Restart the dev server after a reset. This isn't a code bug.
