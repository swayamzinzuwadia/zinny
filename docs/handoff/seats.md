# seats handoff

Seat add-on packs on Zinny licences, the `platform.seat_pricing` permission, the institute's Seats page, and a client proposal for mid-term plan upgrades (`docs/proposals/plan-upgrades.md`). Built inside the zinny-team-panel module (prefix `plat_`).

## Built

- **Packs and their pricing.** One pack adds 25 students or 5 staff by default. The year price before GST is ₹2,500 per student pack and ₹3,000 per staff pack. The defaults are stored in `plat_billing_settings`, and a plan can override any field (`plat_plans.*_pack_*`; empty means the default).
  - Edit the defaults at `/platform/billing/settings#seat-packs`.
  - Edit a plan's own packs at `/platform/plans/[id]` ("Seat packs on this plan").
  - Both need `platform.seat_pricing`. Without it, the forms show read-only.
- **Decision: separate student and staff packs.** Students are what institutes run out of, so student packs are the main product and the default the forms open on. Staff packs are a separate, smaller setting (5 per pack) so that adding faculty doesn't need a whole 25-person pack. Each kind moves only its own cap.
- **Mid-term price** (`lib/seat-packs.ts`, `quotePacks`):
  `charge = packs × year price × (months in term ÷ 12) × (days left ÷ days in term)`
  - It is computed in one division and rounded once to the nearest rupee (halves go up).
  - Days left count the purchase day and the last day. A purchase before the term starts pays the whole term.
  - A term that isn't 12 months pays its share of the year. For example, a 3-month Pilot pays a quarter of the year price.
  - GST goes on top at the plan's rate, split CGST/SGST or IGST by state, through the existing `issueInvoice` (`lib/charge.ts`).
  - Worked example: 2 student packs on 1 Oct, in a 1 Apr to 31 Mar term, cost ₹2,493 + ₹448.74 GST = ₹2,941.74.
- **Licence page** (`/platform/licences/[id]`, "Seat packs" card):
  - Shows the packs held and the pack terms for the licence's plan.
  - **Add packs** shows the price as you type and can be invoiced, or free with a written reason.
  - **Remove packs** takes the newest first and requires a reason.
  - **Set the caps by hand** (needs `platform.seat_pricing`) has an optional charge, which is invoiced for the rest of the term.
  - **Pack history** comes from the audit log, along with the list of purchases and their invoices.
  - Every change goes through `logAction`/`audit` (`plat.seats.add|remove|caps|renew`) and also lands in the institute's own log.
- **Caps and packs.** `plat_licences.student_cap/staff_cap` always hold the total cap, packs included. As a result, usage, warnings and every other page stay correct without knowing about packs.
  - `plat_seat_packs` records each purchase, with how many of its packs are still on the licence.
  - Editing a cap on the licence form while the licence stays on the same plan now also needs `platform.seat_pricing`. Changing plan still sets the caps agreed for that plan.
- **Renewal.** Packs still on the licence renew with it, on their own invoice per kind, at the pack price on the renewal day (`renewPacksTx` in `licences.ts`). This applies to both manual and automatic renewals. If the pack size has changed since purchase, a pack is priced by its people.
- **Removal.** Seats come off at once and the packs stop renewing. Invoices already raised are left alone, because there are no credit notes yet.
- **New permission `platform.seat_pricing`** ("Edit seat packs and user caps", in the Billing section of the role editor).
  - Super Admin has it by default (`ROLE_GRANTS`).
  - It can be ticked on custom Zinny team roles at `/platform/roles` (which `/platform/team/roles` redirects to).
  - It brings `platform.licences` with it (`needs`).
  - Adding or removing packs needs only `platform.licences`.
- **Institute Seats page** (`/[uni]/admin/settings/seats`):
  - Shows usage against the caps and the packs held.
  - **Buy N packs** shows the pro-rated price, CGST/SGST or IGST and the total before buying. The button reads "Buy 2 packs for ₹339.84".
  - The total the page showed is sent with the purchase. If the price has changed since the page was shown, nothing is bought and the new price is shown instead.
  - The page lists the institute's Zinny invoices, with a **Pay** button that uses the existing mock gateway (`gateway().createOrder`). The button only appears while the test gateway is on (development or `ZINNY_DEMO=1`). Otherwise the invoice stays due and the page explains how to pay by bank transfer.
  - Buying needs `settings.manage` and isn't allowed while viewing as someone else. `finance.view` can look.
- **Seed.** Billing settings get 25 students for ₹2,500 a year and 5 staff for ₹3,000. Asha (Demo University admin) bought one extra pack 30 days ago and paid it online.
  - The extra pack is a **staff** pack (Pilot staff cap 20 plus 5 makes 25). I chose staff so that the Demo University stays at 12 of 13 students, which keeps the student-cap warning that the seed test and the platform home rely on.
  - Alerts are synced again afterwards, so the licence-end warning stays.
- **Proposal:** `docs/proposals/plan-upgrades.md` covers pro-rated credit, the end-date options, packs absorbed on upgrade, downgrades only at renewal, who can upgrade, GST invoices and credit notes, three worked ₹ examples, edge cases, open questions, and seat packs as built with a worked example.
- **Tests:** `tests/zinny-team-panel/seat-packs.test.ts` (14 tests). They cover:
  - pro-rating maths: days left, short terms, rounding, renewal at a changed size, plan overrides;
  - packs raising and lowering caps;
  - the invoice's GST (IGST and CGST/SGST);
  - no packs after the licence has ended;
  - renewal at the price then;
  - allow and deny for `platform.seat_pricing` (Super Admin and a custom role allowed; Account Manager, Finance and a custom role without it refused, including caps typed on the licence form);
  - an institute buying and paying only for itself;
  - refusal for students and for the Zinny team's own connection;
  - `expectTenantIsolated(platSeatPacks)`.
  - Existing tests that set caps by hand now act as a Super Admin.
- **Screenshots** in `docs/handoff/seats/`: `licence.png`, `billing-settings.png`, `plan.png`, `institute-seats.png`, `institute-seats-tablet.png`.

## Not built (and why)

- **Plan upgrades:** a proposal only, as briefed.
- **Credit notes or refunds when packs are removed:** Zinny billing has no credit notes. Finance revises an invoice by hand. See the proposal.
- **Cap fields on the licence form are not locked in the UI** for people without `platform.seat_pricing`. `components/licence-fields.tsx` isn't mine. The service refuses with a clear message instead.

## Contracts used / provided

- Core API: `assertPlatform`, `canPlatform`, `assertCan`, `can`, `withTenant`, `audit`, `gateway()`.
- No events emitted or handled. No slots registered.
- The institute reads its own licence, packs and invoices under row-level security (`withTenant`).
  - Zinny's price list (plans, billing settings) and the invoice counter are Zinny-only tables. The purchase is therefore priced and written on the module's system connection, after `assertCan` and only ever for `actor.universityId`. This is the same exception the panel's billing job already uses.

## New packages

None.

## New environment variables

None.

## Requests for other owners

- **Institute admin menu:** add a "Seats" item linking to `/[uni]/admin/settings/seats`. A tile on `/[uni]/admin/settings` would also help. I don't own either.
- **zinny-team-panel `components/licence-fields.tsx`:** make the student and staff cap inputs read-only when the actor lacks `platform.seat_pricing` and the plan is unchanged, and point people to the Seat packs card.
- **zinny-team-panel `platform-nav.tsx`:** show "Billing settings" to anyone with `platform.seat_pricing`, so a custom role holding only that permission can reach the pack prices. The page itself already lets them in.
- **Integrator:** generate a migration for the new `plat_seat_packs` table, the pack columns on `plat_plans` and `plat_billing_settings`, and the new check constraints.
- **`npm run check:ownership`:** it doesn't know the agent name "seats" ("Unknown agent"). It needs an entry for this brief's ownership list.

## Known issues

- Full suite: 1,653 passed and 4 failed (152 files). None of the four failures are in files this work touches:
  - `tests/core/core-api.test.ts` › "exports exactly the listed functions": the core facade exports more functions than the test lists.
  - `tests/core/focus-mode.test.ts` › "the learner header and tab bar are marked as chrome".
  - `tests/reports-board/insights.test.ts`: expects "the whole university", gets "the whole institute".
  - `tests/zinny-team-panel/records.test.ts` › "Super Admins invite people…": expects "already a Support Agent", but `services/team.ts` (not touched) says "already has that role".
- In the seed, the purchase is dated 30 days ago, but its history and purchase rows show the time the seed ran, because `createdAt` and the audit time are the real clock.
- The mid-term amount before GST is whole rupees. GST is worked out on it to the paisa, so a total like ₹2,941.74 can have paise.
