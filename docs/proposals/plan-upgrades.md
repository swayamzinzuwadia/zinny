# Upgrading a plan mid-term: a proposal

For the client discussion. Nothing in the "Plan upgrades" sections is built yet. The last section describes seat packs, which are built and live in the Zinny team panel and on each institute's Seats page.

All prices are before GST unless marked otherwise. GST is 18%. When the institute is in the same state as Zinny the 18% is split into 9% CGST and 9% SGST; otherwise it is 18% IGST. The total is the same either way.

## The idea in one paragraph

An institute that outgrows its plan should not have to wait for renewal. It moves to a bigger plan on the day it asks. Its new student and staff caps and its new modules switch on at once. It pays for the bigger plan only for the time it will use it, and gets credit for the part of the old plan it paid for but will no longer use. Moving to a smaller plan happens only at renewal.

## How the credit and the new charge work

On the day of the upgrade, Zinny works out two amounts:

- **Credit for the old plan:** what the institute paid for its current term, times the share of the term not yet used.
  `credit = amount paid for the term × days left ÷ days in the term`
- **Charge for the new plan:** depends on the end-date option (next section).

Both are rounded to the nearest rupee. Days left count the upgrade day and the last day of the term.

"Amount paid" means what was actually invoiced, after any discount. A discount the institute received is not given back to them a second time as credit.

## End-date options

| | Keep the same end date | Restart the term |
|---|---|---|
| New term | Upgrade day to the old end date | Upgrade day plus a full billing period (usually 12 months) |
| New plan charge | New plan price × days left ÷ days in the term | Full new plan price |
| Renewal date | Unchanged | Moves to one period after the upgrade day |
| Good for | Institutes that budget by academic year and want one renewal date | Institutes that want a clean new year, or whose term is nearly over |

**Recommendation:** keep the same end date by default, and let the Zinny team choose "restart the term" when the institute asks for it. Near the end of a term (for example, under 60 days left), suggest restarting, since a short top-up followed by an immediate renewal invoice is confusing.

## What switches, and when

- **Caps:** the new plan's student and staff caps apply the moment the upgrade is saved. Warnings about being close to a cap are worked out again straight away.
- **Modules:** the new plan's modules switch on at once. Modules the institute had turned on for it by hand stay on.
- **Seat packs:** absorbed into the new plan (see below).
- **Price at renewal:** the new plan's price on the day it renews, as for any licence.

## Seat packs when upgrading

Packs exist to cover growth inside a plan. When an institute upgrades, its packs are usually no longer needed, so:

1. If the new plan's cap is at least the old cap including packs, the packs are **absorbed**: they come off the licence, stop renewing, and their unused days are credited exactly like the old plan.
2. If the old cap with packs is still bigger than the new plan's cap, the institute keeps **just enough packs** to stay at or above its current cap. The rest are absorbed and credited. Kept packs continue at the new plan's pack price from the next renewal.

The institute never ends up with a lower cap than it had the day before the upgrade.

## Downgrades

Downgrades happen only at renewal, never mid-term, and no credit is given for the remaining term. If the institute has more active students or staff than the smaller plan allows, the renewal shows a warning and the Zinny team decides whether to add packs, keep the bigger plan, or ask the institute to archive people first.

## Who can upgrade

Two ways, which we suggest offering together:

- **Self-serve by the institute:** an institute admin picks a bigger plan on the Seats page, sees the credit, the charge, GST and the total, and confirms. The new caps and modules apply as soon as the invoice is raised (as with seat packs today), or only once it is paid, depending on the answer to open question 3.
- **By the Zinny team:** on the licence page, with the end-date option and an optional discount. A custom price or custom plan always goes through the Zinny team.

A permission such as "Upgrade plans" would control which Zinny team members can do this, in the same way "Edit seat packs and user caps" controls packs today.

## GST invoices and credit notes

Two ways to bill the difference:

- **A. One invoice for the net amount.** Simple to read, but it hides the credit inside a single line and doesn't reduce the tax already declared on the original invoice.
- **B. A new tax invoice for the new plan, plus a GST credit note against the original invoice for the unused part.** This is the normal way under GST: the credit note reduces the tax on the original supply, and both appear correctly in Zinny's GST returns. The institute pays the difference.

**Recommendation: B.** Zinny's billing currently has invoices and revisions but no credit notes, so credit notes would be new work: their own numbering series, a PDF, and a link to the original invoice. Under GST rules a credit note for a financial year must be issued by 30 November of the following year.

If the original invoice is still unpaid, the simpler path is to revise it down to the used part and raise the new invoice as normal.

## Worked examples

### Example 1: Campus Plus to Standard, keeping the same end date

- Current plan: Campus Plus, ₹3,60,000 a year, 400 students, 30 staff. Term 1 April 2026 to 31 March 2027 (365 days), paid in full.
- The institute also holds 2 student packs (50 students) bought at the start of the term for ₹5,000.
- Upgrade on 1 October 2026 to Standard: ₹7,20,000 a year, 1,000 students, 60 staff.
- Days left: 1 October 2026 to 31 March 2027 = 182 of 365 days.

| Line | Before GST |
|---|---|
| Standard for 182 of 365 days: ₹7,20,000 × 182 ÷ 365 | ₹3,59,014 |
| Credit for Campus Plus: ₹3,60,000 × 182 ÷ 365 | −₹1,79,507 |
| Credit for the 2 absorbed packs: ₹5,000 × 182 ÷ 365 | −₹2,493 |
| **Difference** | **₹1,77,014** |

With option B billing:

| Document | Before GST | GST 18% | Total |
|---|---|---|---|
| Tax invoice: Standard, 1 Oct 2026 to 31 Mar 2027 | ₹3,59,014 | ₹64,622.52 | ₹4,23,636.52 |
| Credit note against the Campus Plus and pack invoices | −₹1,82,000 | −₹32,760.00 | −₹2,14,760.00 |
| **The institute pays** | | | **₹2,08,876.52** |

The caps go from 450 students (400 + 50 in packs) and 30 staff to 1,000 students and 60 staff the same day. The licence still renews on 1 April 2027, at Standard's price then.

### Example 2: the same upgrade, restarting the term

- New term: 1 October 2026 to 30 September 2027.
- Standard for a full year: ₹7,20,000. Credit as above: ₹1,82,000.
- Difference: ₹5,38,000 before GST, ₹96,840 GST, **₹6,34,840** in all.
- The licence next renews on 1 October 2027.

### Example 3: a Pilot that converts early

- Pilot: ₹45,000 for 3 months, 11 September to 10 December 2026 (91 days).
- Upgrade on 20 November 2026 (21 days left) to Standard, restarting the term (recommended, since the pilot is nearly over).
- Credit: ₹45,000 × 21 ÷ 91 = ₹10,384.62, so ₹10,385.
- Standard for a year from 20 November 2026: ₹7,20,000. Difference ₹7,09,615 before GST; ₹1,27,730.70 GST; ₹8,37,345.70 in all.

## Edge cases

- **Discounted licence:** credit is based on what was invoiced after the discount. Whether the new plan keeps a discount is the Zinny team's call at the time of the upgrade.
- **Old invoice unpaid:** revise it to the used part instead of issuing a credit note; the new invoice is raised as normal.
- **Renewal invoice already raised** (renewals go out 15 days before the end date): cancel or revise it as part of the upgrade, so the institute isn't asked to pay for the old plan again.
- **Upgrade on the first or last day:** works with the same formula. On the first day the credit is the whole amount paid; on the last day it is one day's worth.
- **Free or zero-price plans:** no credit.
- **Plan switched off (archived) since the licence started:** the institute can still upgrade away from it. It can't upgrade to an archived plan.
- **Several upgrades in one term:** each one credits what the previous one charged, for the days still left.
- **Rounding:** each line is rounded to the rupee, and GST is worked out on the rounded amount. The institute pays to the paisa.
- **Over the new cap:** not possible on an upgrade, since caps only go up. On a downgrade at renewal, see Downgrades.

## Open questions for the client

1. Default end-date option: keep the same end date, or restart the term?
2. Should self-serve upgrades be on for every institute, or only for those the Zinny team switches it on for?
3. Do the new caps and modules start when the invoice is raised, or only once it is paid? (Seat packs today start straight away.)
4. Credit notes (option B) or a single net invoice (option A)? Option B needs new work in billing.
5. Should a discount on the old plan carry over to the new plan automatically?
6. Is there a minimum number of days left below which we always restart the term?
7. Should downgrades at renewal be self-serve, or always go through the Zinny team?
8. Refunds: do we ever pay money back (for example, packs removed mid-term), or only give credit against the next invoice?

---

## Seat packs, as built

Seat packs let an institute add users in the middle of a licence term without changing plan.

**What a pack is.** A pack adds a fixed number of people to the licence's cap: 25 students by default, or 5 staff. Each kind has a year price before GST: ₹2,500 for 25 students and ₹3,000 for 5 staff by default. A Super Admin (or anyone given "Edit seat packs and user caps") sets these in Billing settings and can give a plan its own pack size and price.

**Buying.** An institute admin buys packs on the institute's Seats page and sees the price, GST and total before confirming. The Zinny team can also add packs on the licence page, with an invoice or free with a note. The seats are added at once.

**Price in the middle of a term.**

`charge = packs × year price × (months in the term ÷ 12) × (days left ÷ days in the term)`

rounded once, to the nearest rupee, then GST on top. Days left count the day of purchase and the last day of the term.

**Example.** A Standard licence runs 1 April 2026 to 31 March 2027 (365 days). On 1 October 2026 the institute buys 2 student packs (50 students).

| Line | Amount |
|---|---|
| 2 × ₹2,500 × 182 ÷ 365 = ₹2,493.15, rounded | ₹2,493.00 |
| GST 18% | ₹448.74 |
| **Total** | **₹2,941.74** |

The student cap goes up by 50 straight away, and an invoice for ₹2,941.74 is raised, due after Zinny's usual payment terms.

**Renewal.** Packs still on the licence renew with it, on an invoice of their own, at the pack price on the day it renews (not the price they were bought at).

**Removing packs.** The Zinny team can take packs off, newest first, with a reason. The seats come off at once and the packs stop renewing. Money already invoiced stays as it is; a refund would be a manual revision by finance until credit notes exist.

**Changing caps directly.** Someone with "Edit seat packs and user caps" can set the student and staff caps by hand, with a reason and an optional charge. Every change to packs and caps is recorded in the licence's pack history and the institute's activity log.
