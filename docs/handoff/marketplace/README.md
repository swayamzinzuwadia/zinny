# marketplace handoff: recorded and live

## Built
- Two halves with stable URLs: `/marketplace/recorded` (courses, lectures, combos; type, on-offer and sort filters) and `/marketplace/live` (live batches; yet to start / running now, sort by start or price). The home shows both doors side by side, a shelf of each and the institutes. Search on the home looks in both and groups the results by half.
- Listing kind `batch`: a seat in a real batch at a marketplace price, with compare-at price, description and late joining. Buying goes through the cart, bundle checkout, payment, invoice and refund flow and ends in a normal enrolment in that batch (role `individual_learner`). The batch's seat limit and the 10-minute hold apply (`holdMarketplaceSeat`). A full batch shows "Batch full" and can't be bought or put in a cart.
- A live listing stops being offered on its own (nothing is written) when the batch is past its end date, not open, needs faculty approval, or has started without late joining.
- `/marketplace/institutes` (every active institute, sellers first, search by name) and `/marketplace/institutes/[slug]` (Recorded, Live batches, Upcoming tabs; `generateMetadata`). About text, city, logo and colour come from the institute's published website (`getSite`), else name and brand colour.
- Admin: "List a live batch" on Marketplace and on the course's Marketplace tab, with the reason when a batch can't be listed; pause, relist, remove; seats sold through the marketplace.
- Buyer's learner app: a Timetable tab when they hold a live seat; join links work for them.

## Not built (and why)
- A buyer who owns a course's recordings can't also buy one of its live batches (and the other way round): core allows one live enrolment per person per course.
- No clash warning when a buyer's live batches overlap.
- The directory isn't paginated.

## Contracts used / provided
- Core API: added `holdMarketplaceSeat` (exported from `@/server/core`). Handles `payment.refunded` (now also ends a marketplace seat in a live batch on a full refund).

## New packages
None.

## New environment variables
None.

## Requests for other owners
- `individual_learner` now has `self.join_class` (`src/server/authz/roles.ts`), and the join route lets that role through. Please confirm.
- `/marketplace?institute=<slug>` redirects to the institute's page; links in website-builder and elsewhere still work but could point there directly.

## Known issues
- The second demo institute only gets listings from the second `db:seed` on (the Zinny team panel's seed creates it after the marketplace seed runs).
- `drizzle-kit push` doesn't apply a check constraint whose text alone changed, so the kind and status checks were renamed (`mkt_listing_kinds`, `mkt_listing_statuses`).
