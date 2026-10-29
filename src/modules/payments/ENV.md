# payments: environment variables

| Variable | Example | What it does |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_AbCdEf123456` | Razorpay API key id. With `RAZORPAY_KEY_SECRET` set too, payments registers the Razorpay gateway and every new checkout goes through Razorpay. Without both, core keeps its mock gateway. `rzp_test_` keys run Razorpay in test mode (no real money). The key id is public: it's sent to the browser for Razorpay Checkout. |
| `RAZORPAY_KEY_SECRET` | `••••••••` | Razorpay API key secret. Server only. Signs and verifies the Checkout signature and authenticates API calls (orders, captures, refunds). Never sent to the browser. |
| `RAZORPAY_WEBHOOK_SECRET` | `••••••••` | The secret you type when creating the webhook in the Razorpay dashboard. Every webhook's `x-razorpay-signature` is checked against it. **Without it every webhook is refused**, so payments then rely on the checkout callback and the hourly reconcile job. |
| `RAZORPAY_API_BASE` | `https://api.razorpay.com/v1` | Optional. Defaults to Razorpay's API. Tests point it at a fake. Leave it unset in production. |
| `APP_URL` | `https://app.zinny.in` | Optional, shared with identity and notifications-delivery. Links in the "your invoice is ready" email start with it. Falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL`, then `http://localhost:$PORT`. **Set it in production.** |
| `ZINNY_DEMO` | `1` | Existing (core). On a production build, `1` keeps the mock gateway's test-mode "Pay" button for demo sites. On any other production site without Razorpay keys, checkout says payments aren't set up instead of offering free test payments. |

Storage for invoice PDFs uses core's storage settings (`STORAGE_DRIVER`, `S3_*`); see contracts.md section 7.

## Razorpay dashboard settings

- **Webhook URL:** `https://<your domain>/api/payments/razorpay`
- **Secret:** the same value as `RAZORPAY_WEBHOOK_SECRET`
- **Active events:** `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`
- **Payment capture:** automatic (Settings → Payment capture). Zinny also captures an authorised payment itself when it verifies the checkout, and the hourly job does the same for any it finds.
- **Payment methods:** Zinny's checkout shows UPI, cards and netbanking only.

## Cron

The hourly job `payments.reconcile` runs through core's `GET /api/jobs/run?every=hour` (Bearer `CRON_SECRET`). It confirms payments whose browser callback and webhook were both missed, and finishes refunds Razorpay hadn't confirmed yet.
