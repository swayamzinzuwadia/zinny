# fin handoff: optional GST, invoice categories, invoice generation

## Built
- **GST is optional per institute.** Finance → Sales → Invoice settings has "Charge GST on fees" (`finance.manage`, audited as `finance.gst_setting`). Off: new orders are created with GST 0, order invoices are plain invoices (no GSTIN, SAC, tax rows, titled "Invoice"), and no price shows GST on the course admin pages, the institute's public site, checkout, Sales or the PDF. Existing orders and invoices never change; turning GST back on affects new orders only. An order placed while GST was on keeps its GST even if paid after it's turned off.
- **Invoice categories** (Finance → Invoices → Categories): create, rename, default GST rate and SAC code, archive, restore. "Course fees" is built in (derived, no row).
- **Invoices** (Finance → Invoices): one list of order invoices and invoices the institute raises, with filters, totals (billed, collected, outstanding, overdue), a per-category summary and CSV export. Create invoice form with live totals, bill-to search or typed details, lines, discount, GST rate from the category, CGST/SGST or IGST by the buyer's state. Detail page with record payment, mark unpaid, cancel (reason), edit while unpaid, history and PDF.
- **Learner side** (`/learn/invoices`): raised invoices next to order invoices with status and due date, PDF download, a notification when one is issued or cancelled.
- Seed: Exam fees, Hostel, Library, Workshop, an archived Transport, and seven invoices across every state.

## Schema changes
- `universities.gst_enabled boolean not null default true`
- `pay_invoice_categories`, `pay_manual_invoices`, `pay_manual_invoice_lines`, enum `pay_manual_invoice_status`

## Contracts used / provided
- Core API additions exported from `@/server/core`: `splitGst`, `nextInvoiceNumber`, `gstEnabledFor`, `setGstEnabled`.
- `UniversityLite.gstEnabled` (set in `universityBySlug` and `universityLite`).
- Notifications use the existing `payments.invoice` kind.

## New packages
None.

## New environment variables
None.

## Requests for other owners
- Marketplace UI: `components/price.tsx`, `marketplace/[listingId]`, cart and bundle checkout pages still say "+ GST" / "GST is added at checkout" for every listing. Totals are already right (0 GST for a seller with GST off); the wording needs a per-listing flag.
- Website builder home page: the recordings strip says "+ GST" for marketplace listings.
- notifications-delivery: the `payments.invoice` kind is labelled "GST invoice … after payment"; it now also carries invoices raised by the institute.
- `tests/core/core-api.test.ts` lists the core exports; add the four names above.

## Known issues
- Whether an order invoice is a GST one is derived (tax above zero, or a GSTIN on it), because core `invoices` has no flag. A GST-registered-off case that looks the same: GST on, no GSTIN, 0% course.
- Raised invoices are rendered on demand, not stored, since their status changes.
- People without an account aren't emailed their invoice; download the PDF and send it.

Screenshots in this folder are numbered in the order of the click-through.
