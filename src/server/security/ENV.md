# security: production secrets and settings

No new variables. This page collects, in one place, the secrets production needs (each is also described by the module that uses it), and what happens when one is missing.

## Required in production (the app refuses to serve without them)

When `NODE_ENV=production` (`next start`, every Vercel deployment), `src/proxy.ts` answers every request with a plain `503` until these are set, and logs the names (never the values) once. This stops a deployment from quietly falling back to development constants that anyone can read in the source.

| Variable | Rule | Why |
|---|---|---|
| `AUTH_SECRET` | 32+ characters (`openssl rand -base64 48`) | Keys the HMAC that stores phone sign-in codes (identity). Without it the code falls back to `CRON_SECRET`, then to a public constant. |
| `CRON_SECRET` | 32+ characters, different from `AUTH_SECRET` | Vercel Cron sends it as `Authorization: Bearer …` to `/api/jobs/*`. It is also the fallback key for signed file links (`STORAGE_SIGNING_SECRET`), unsubscribe links (`NOTIFICATIONS_SIGNING_SECRET`) and the website's sender fingerprints (`SITE_FINGERPRINT_SECRET`). |
| `KYC_ENCRYPTION_KEY` | 32 bytes: 64 hex characters or base64 | Encrypts student PAN numbers (onboarding). Not required when `ZINNY_DEMO=1`, which holds demo data only. |
| `RAZORPAY_WEBHOOK_SECRET` | set whenever `RAZORPAY_KEY_ID` is set | Verifies Razorpay webhooks (payments). Without it no paid order is ever confirmed. |

## Recommended in production

| Variable | Why |
|---|---|
| `STORAGE_SIGNING_SECRET`, `NOTIFICATIONS_SIGNING_SECRET`, `SITE_FINGERPRINT_SECRET` | Each its own random value, so one leaked key doesn't sign everything. They fall back to `CRON_SECRET`. |
| `APP_URL` | The public address used in email links (identity). |
| `ZINNY_DEMO` | Leave **unset** on a real deployment. `1` shows one-click demo sign-ins on `/login`, allows test-mode payments and the development KYC key. Only for the shareable demo (`docs/deploy/preview-vercel-neon.md`). |

## Content-Security-Policy and the file store

With `STORAGE_DRIVER=s3`, the origin of `S3_ENDPOINT` is added to the policy's `media-src`, `connect-src` and `frame-src`, because signed links send videos and PDFs straight from the bucket. Nothing else to set.

## Headers and limits (no settings)

- The CSP, HSTS and the other headers are listed in `docs/report/security-web.md`, and defined in `src/server/security/csp.ts`.
- A prerendered page must be listed in `STATIC_ROUTES` there, and a route handler must match `HANDLER_ROUTES` (the proxy leaves its headers alone); `npm run build` fails otherwise (`check-static-csp.ts`).
- Marketplace searches: 60 a minute per network, per server instance. Wrong joining codes: 10 an hour per person, 60 an hour per network, kept in `idn_throttles`.
