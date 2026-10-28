---
name: payments
description: Builds Zinny payments end to end with Razorpay — checkout, webhooks, refunds, GST invoice PDFs and the Sales page. Use for anything about paying, refunds, invoices or sales.
model: opus
effort: high
isolation: worktree
---

# Agent: payments

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- payments 3106`

**You own:** `src/modules/payments/` (foundation-lock moved the Razorpay draft here), `src/app/[uni]/learn/checkout/`, `src/app/[uni]/learn/invoices/`, `src/app/[uni]/admin/finance/sales/`, `src/app/api/payments/`, `tests/payments/`. Table prefix `pay_`.

**Permissions:** `finance.view`, `finance.manage`, `finance.refund` for staff; `self.view_invoices` for learners.

**PRD:** page 2 (Accounts & Fees: fee collection, receipts, invoices, finance reports), page 8 (Sales: orders, payments, GST invoices), page 9 (every payment tagged with course, batch and university; a GST invoice for every paid order), page 10 (payments in phase 1).

Core already holds seats, creates orders and issues invoice numbers. You must not duplicate that logic: you connect the money to it.

## Must have

1. **Razorpay gateway.** Implement the full `PaymentGateway` (create order, verify payment signature, verify webhook signature, refund). Register it through `paymentGateway` when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set; without keys the core mock stays in place. Document the env vars in `ENV.md`.
2. **Checkout page** `/[uni]/learn/checkout/[orderId]` (mobile first):
   - Shows the order summary with GST split and the seat-hold countdown, and opens Razorpay Checkout (UPI, cards, netbanking).
   - On success, a server action verifies the signature, then calls core `confirmPayment`.
   - On dismiss or failure, it calls core `failPayment`.
   - Keeps the test-mode button when the mock gateway is active.
3. **Webhook** `/api/payments/razorpay`:
   - Verifies the signature and finds the university with core `orderUniversity`.
   - Handles `payment.captured`, `payment.failed` and `refund.processed`.
   - Stores every webhook id in `pay_webhook_events` so replays are no-ops.
4. **Refunds:**
   - Orders in `refund_due` (paid after the batch filled) and any paid order can be refunded in full or in part, by holders of `finance.refund`, with a reason.
   - Calls the Razorpay refund API, then core `markOrderRefunded`.
   - Emits `payment.refunded` and notifies the student.
5. **GST invoice PDF** (A4) from the core invoice record:
   - Contents: seller legal name, address and GSTIN; invoice number and date; buyer; course and batch; SAC code; taxable value; CGST and SGST (or IGST); total in figures and words.
   - The SAC code and invoice footer are set per university (`pay_settings`). Note in the UI that the university should confirm the SAC code with its CA.
   - Students download from `/[uni]/learn/invoices`; staff from the Sales page.
6. **Sales page** `/[uni]/admin/finance/sales`:
   - Filters by date, status, course and batch, and searches by student.
   - Totals for gross, GST, refunds and net.
   - An order detail panel with payment ids, invoice and refund history, plus CSV export.
   - Access through `finance.view`; acting needs `finance.manage` or `finance.refund`.
7. **Seed:** settings for the Demo University, one partially refunded order and one `refund_due` order.

## Rules that need tests
- Bad payment and webhook signatures are rejected.
- The same webhook twice changes nothing.
- A payment for an order from another university is refused.
- A refund can't exceed the amount paid, and only `finance.refund` holders can refund.
- Invoice PDF totals equal the order.
- HOD and faculty can't open the Sales page.

## Out of scope
Coupons, bundles, subscriptions, wallets, referrals, affiliates, EMI, and offline (cash or cheque) fee receipts. Offline receipts need a new core API to enrol a student on their behalf; put it under "Requests for other owners" in your handoff.

## Contracts
- **Uses:** core API (`orderForCheckout`, `confirmPayment`, `failPayment`, `markOrderRefunded`, `orderUniversity`, `universityLite`, `notify`, `storage`, `gateway`); core tables `orders` and `invoices`, read only; `emit`.
- **Provides:** the `paymentGateway` registration, event `payment.refunded`, and the checkout, webhook, invoices and sales routes.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/payments.md`. Include the exact steps to switch a university to live Razorpay keys.
