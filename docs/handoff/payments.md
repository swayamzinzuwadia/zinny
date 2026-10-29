# payments handoff

Branch `agent/payments`, from `foundation-v1`. Port 3106. Everything lives in `src/modules/payments/` plus the owned routes.

## Built

**Razorpay gateway** (`razorpay.ts`, `config.ts`, registered in `index.ts`)
- The full `PaymentGateway`: create order, verify the Checkout signature, verify the webhook signature and refund. All signatures are HMAC-SHA256 with constant-time comparison, checked against openssl reference values.
- Extra calls used to double-check money: fetch, capture, an order's payments, a payment's refunds.
- Timeouts, one retry on 5xx and network errors for reads and order creation, and plain error messages. A refund is never retried.
- Registered through `paymentGateway` (a getter that reads the env on each use) when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set. Without them, core's mock gateway stays in place.

**Checkout** `/[uni]/learn/checkout/[orderId]` (mobile first)
- Order summary with the CGST and SGST split, and a gold seat-hold countdown.
- Razorpay Checkout limited to UPI, cards and netbanking.
- On success, a server action verifies the signature and checks the payment with Razorpay (order, amount, INR). It captures the payment if it's only authorised, then calls core `confirmPayment`.
- Failure, dismiss or Cancel all call core `failPayment`.
- States for paid (with the invoice link), refund due, refunded, closed and unavailable.
- The test-mode button (plus "Simulate a failed payment") appears only with the mock gateway, and only in development or with `ZINNY_DEMO=1`.

**Webhook** `POST /api/payments/razorpay`
- Verifies the signature and finds the university with core `orderUniversity`.
- Handles `payment.captured`, `order.paid`, `payment.failed`, `refund.processed` and `refund.failed`.
- Every webhook is stored in `pay_webhook_events` by event id and by body hash, so a replay (including a new event id on an old body) is a no-op.
- Answers 500 on failure so Razorpay retries, and 409 while the same event is in flight.
- Refuses amount, currency or university mismatches and tells Accounts. Flags a second payment for an already-paid order.
- Records refunds made in the Razorpay dashboard.

**Refunds**
- Full or partial refunds by holders of `finance.refund`, with a reason.
- An advisory lock per order means concurrent refunds can never exceed the amount paid.
- Calls the Razorpay refund API. When processed, it emits `payment.refunded` once per refund, notifies the student, and calls core `markOrderRefunded` once refunds cover the total.
- A timeout keeps the amount reserved; the hourly job settles it.

**GST invoice PDF** (A4, pdf-lib, embedded Lexend)
- Rendered from the core invoice record. Contents: seller legal name, address and GSTIN; invoice number and date; buyer; place of supply; course and batch; SAC code; taxable value; CGST and SGST (or IGST) with rates; total in figures and in words; reverse charge.
- The SAC code and footer come from `pay_settings`. The settings page says to confirm the SAC code with a CA.
- The first render is stored and never changes afterwards.
- Students download from `/[uni]/learn/invoices` (also a "My learning" hub section); staff download from Sales.
- Rendered and emailed once on `payment.confirmed`.

**Sales** `/[uni]/admin/finance/sales`
- Filters for date, status (including "Partly refunded"), course and batch, plus a search by student name or email, invoice number or payment id.
- Totals for gross, GST, refunds and net; an order panel with payment ids, the invoice, refund history and the webhook log; the refund form; CSV export (logged, safe against formula injection); and an Invoice settings page.
- Viewing needs `finance.view`; refunding needs `finance.refund`; settings need `finance.manage`. HOD and faculty see a no-access message.

**Hourly job** `payments.reconcile`: confirms payments Razorpay captured but nobody told us about, and settles unconfirmed refunds.

**Seed**: invoice settings for the Demo University, Riya's Python Basics order partly refunded (₹1,000, by Arun), and Neil's `refund_due` order (two checkouts for Digital Marketing, both paid). Neil's order shows on Arun's dashboard and in Sales.

## Not built (and why)
- Coupons, bundles, subscriptions, wallets, referrals, affiliates, EMI and offline fee receipts are out of scope (brief). Offline receipts need a core API; see requests.
- GST credit notes for refunds aren't generated. They aren't in the brief, and they need a numbering series and a core change.
- Invoices assume intra-state supply (CGST and SGST), as core issues them; the PDF prints IGST when core sends it.

## Contracts used / provided
- **Core API used:** `orderForCheckout`, `confirmPayment`, `failPayment`, `markOrderRefunded`, `orderUniversity`, `systemActorFor`, `withTenant`, `audit`, `emit`, `notify`, `storage`, `sendEmail`, `gateway`, `assertCan`, `can`. Core tables are read only: `orders`, `invoices`, `courses`, `batches`, `users`, `universities`, `role_assignments`.
- **Provided:**
  - `paymentGateway` registration.
  - Event `payment.refunded` (`{ orderId, userId, amountPaise }`, once per processed refund).
  - Routes: `/[uni]/learn/checkout/[orderId]`, `/[uni]/learn/invoices` and `/[uni]/learn/invoices/[invoiceId]` (PDF), `/[uni]/admin/finance/sales`, `.../sales/settings`, `.../sales/export` (CSV) and `.../sales/invoices/[invoiceId]` (PDF), `/api/payments/razorpay`.
- **Handled:** `payment.confirmed`, by handler `payments.invoice-ready`.
- **Slots** (keys not reserved in contracts.md; please reserve them): `learnerHubSections.invoices` at order 700 (`self.view_invoices`) and `dashboardCards.refunds-due` at order 700 (`finance.refund`).
- **Job:** `payments.reconcile` (hourly).
- **Tables:** `pay_settings`, `pay_refunds`, `pay_webhook_events` and `pay_invoice_documents`, with enums `pay_refund_status` and `pay_webhook_status`.

## New packages
- `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1 (dependencies) render the invoice PDFs.
- `unpdf` 1.8.1 (devDependency) reads PDF text in tests.

## New environment variables (also in src/modules/payments/ENV.md)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- Optional: `RAZORPAY_API_BASE` (tests only) and `APP_URL` (shared with identity and notifications-delivery).

## Switching a university to live Razorpay keys
Keys are per deployment, because the contract registers one gateway. Every university on a deployment collects into that deployment's Razorpay account.
1. In the Razorpay dashboard, finish account activation (KYC and the settlement bank account), then switch the mode toggle to **Live**.
2. Go to **Settings → API Keys → Generate Live Key**, and copy the key id (`rzp_live_…`) and the secret.
3. Go to **Settings → Webhooks → Add New Webhook**, still in Live mode:
   - URL: `https://<your domain>/api/payments/razorpay`
   - Secret: a new random string
   - Events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`
4. Under **Settings → Payment capture**, choose automatic capture.
5. In the hosting environment (Vercel → Project → Settings → Environment Variables → Production), set:
   - `RAZORPAY_KEY_ID=rzp_live_…`
   - `RAZORPAY_KEY_SECRET=…`
   - `RAZORPAY_WEBHOOK_SECRET=<the webhook secret>`
   - `APP_URL=https://<your domain>`

   Make sure `CRON_SECRET` is set and the hourly cron calls `/api/jobs/run?every=hour`.
6. Redeploy. Seat holds started before the switch keep their old gateway, so ask students to pick the batch again. Orders paid with test keys can't be refunded with live keys.
7. Check it: as a student, pay a ₹1 course with UPI. It should enrol you and show the invoice. In the Razorpay webhook log the delivery should be green, and Sales should show the payment id. Then refund it from Sales.
8. As Accounts, open **Sales → Invoice settings**, confirm the SAC code with the university's CA, and add the footer. Ask Zinny support to fill in the legal name, address and GSTIN if the settings page says they're missing.

## Requests for other owners
- **Core:** export `holdSeat` (or a seed helper) from `@/server/core`. The payments seed imports `holdSeat` from `@/server/services/enrolment` to create its `refund_due` order, because no core API can create an order.
- **Core:** an API to record an offline (cash or cheque) payment and enrol the student on their behalf, for offline fee receipts.
- **Core:** remove or guard `payTestAction` in `src/app/[uni]/learn/actions.ts`. Payments no longer uses it. It confirms payments whenever the mock gateway is active, even in production without `ZINNY_DEMO`.
- **Core:** `confirmPayment`'s `refund_due` notification always says the batch filled up. It also fires when the student already holds another seat in the course (two checkouts), so the text should cover both.
- **Contracts:** reserve slot keys `learnerHubSections.invoices` and `dashboardCards.refunds-due` (order 700) for payments.
- **Contracts and core:** per-university gateway credentials, e.g. `paymentGateway(universityId)`, so each university can settle into its own Razorpay account. Today one deployment means one account.
- **Core:** GST credit-note numbering, for refunds after an invoice.
- **Learner nav (core):** an "Invoices" entry. Today learners reach invoices from My learning and from the paid checkout.

## Known issues
- Invoice PDFs draw Latin scripts only (Latin-1 and Latin Extended-A). Other characters in names, such as Devanagari, print as "?", because pdf-lib can't shape Indic scripts.
- Demo seed only: the core seed's invoices are rendered by the `payment.confirmed` handler before the payments seed saves the demo settings, so the payments seed drops those renders to re-render them with the demo footer. Real invoices are never re-rendered.
