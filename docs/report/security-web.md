# Zinny: web security review

**Scope:** what the browser sees and the platform settings around it: security headers and Content-Security-Policy, cross-site request forgery, cross-site scripting, open redirects, rate limiting and bots, cookies, error pages, dependencies, committed secrets, and Vercel/production configuration.

**Out of scope:** sign-in, sessions and roles (the identity team), and row-level security, API endpoints, file storage and the data console (the data team). Issues found in those areas are listed under "For other owners" and were not changed.

**Version reviewed:** commit `b2d71f6` on Next.js 16.4.5, React 19.1. Reviewed on 25 November 2026.

## Summary

Zinny already had strong foundations: rich text is sanitised against allow-lists, user-entered links accept only web addresses, sign-in redirects only go to Zinny pages, sign-in, phone codes, password resets, sign-ups, demo requests and website forms are rate limited, cookies are set safely, error pages are generic, and no secrets are committed. There were no critical or high-severity issues.

The main gap was the browser layer. No page sent a Content-Security-Policy or any frame protection, so a single script-injection bug anywhere would have run with a signed-in user's full access, and any site could have framed the admin panel. Production could also start without its secrets and quietly use development values. Joining codes could be guessed without limit, which would let a stranger find institutes and sign up as their students.

All of these are fixed, with regression tests. Three low or informational items are for other owners or for deployment settings.

| Severity | Found | Fixed | Open | Accepted |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 |
| Medium | 4 | 4 | 0 | 0 |
| Low | 5 | 4 | 1 | 0 |
| Informational | 5 | 2 | 2 | 1 |
| **Total** | **14** | **10** | **3** | **1** |

## Findings

| ID | Severity | Title | Where | Impact | Status | Test |
|---|---|---|---|---|---|---|
| WEB-01 | Medium | No Content-Security-Policy | Every page | Any script-injection bug would run with the visitor's full access: read their data, act as them. Nothing limited where scripts, frames or form posts could come from or go to. | **Fixed.** Strict per-request nonce policy with `'strict-dynamic'` on every page rendered per request; prerendered pages (institute websites, `/book-a-demo`, `/signup/institute`, `/suspended`) get a same-origin policy because their HTML can't carry a nonce. `npm run build` now fails if a prerendered page would get the wrong policy. Browser check: no violations. | `tests/security/web-headers.test.ts` |
| WEB-02 | Medium | Pages could be framed by any site (clickjacking) | Every page | A hostile site could show the admin panel or checkout in an invisible frame and trick a signed-in user into clicking buttons. | **Fixed.** `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Only the PDF file routes our own viewer frames get `SAMEORIGIN`. | `web-headers.test.ts` |
| WEB-03 | Medium | Production started without its secrets and used public development values | `AUTH_SECRET`, `STORAGE_SIGNING_SECRET` fall back to constants written in the source; `KYC_ENCRYPTION_KEY` was only checked when first used | A deployment that forgot a secret would key phone-code hashes, and possibly signed file links, with a value anyone can read on GitHub. | **Fixed.** In production the app answers every request with a plain 503 until `AUTH_SECRET` and `CRON_SECRET` (32+ characters), `KYC_ENCRYPTION_KEY` (32 bytes, not needed on the demo) and, with live Razorpay keys, `RAZORPAY_WEBHOOK_SECRET` are set. Names are logged, never values. Verified against `next start`. | `web-env.test.ts`, `web-headers.test.ts` |
| WEB-04 | Medium | Joining codes could be guessed without limit | `/signup?code=` (no sign-in needed), `/join?code=`, the join form | A matching code shows the institute's name and lets anyone create a student account there (straight in when the institute uses instant joining). With about a billion codes, automated guessing would find institutes in hours. | **Fixed.** Wrong codes are counted in Postgres (so the limit holds across servers): 10 an hour per signed-in person, 60 an hour per network (generous for a class typing a code together), then a lock of 1 hour or 30 minutes. | `web-rate-limit.test.ts` |
| WEB-05 | Low | Route handlers that change data had no origin check | Uploads, lesson progress, attendance start, content upload `PUT` | Server actions are origin-checked by Next.js, route handlers are not. The `SameSite=Lax` session cookie stops other sites, but not a sibling subdomain. | **Fixed.** Every `POST`/`PUT`/`PATCH`/`DELETE` from a browser must say `Sec-Fetch-Site: same-origin`, or carry an `Origin` that matches the host; otherwise 403. The Razorpay webhook and one-click unsubscribe (signed, no cookies) are exempt. | `web-origin.test.ts` |
| WEB-06 | Low | Missing transport and browser-isolation headers | Every response | No HSTS (first visit could be downgraded to http), no site-wide `nosniff`, referrer policy only on two pages, no limits on camera, microphone or location, no opener isolation. | **Fixed.** See "Headers" below. | `web-headers.test.ts` |
| WEB-07 | Low | Blog posts were sanitised only when saved | Institute website blog | A post changed outside the editor (an import, a database fix) would have been shown as raw HTML on the public site. | **Fixed.** Sanitised again when the page renders, like lesson text and assignment instructions already were. | `web-xss.test.tsx` |
| WEB-08 | Low | Public marketplace search was unthrottled | `/marketplace?q=` | Each search scans listings; unlimited searching invites scraping and load. | **Fixed.** 60 searches a minute per network, per server instance; then 429 with `Retry-After`. Browsing is not limited. | `web-rate-limit.test.ts` |
| WEB-09 | Low | Stored files can be shown inline on Zinny's own address | `/api/storage/*` (local file storage) | A file opened without a download name is served with its stored type, so an HTML or SVG upload would render on Zinny's origin. Upload allow-lists make this unlikely today (assignments store `.html` as plain text, website images refuse SVG, photos are raster only). | **Open**, for the storage owner: send `Content-Disposition: attachment` or `Content-Security-Policy: sandbox` for anything but images, video and PDF. | n/a |
| WEB-10 | Info | Framework disclosed in a header | `X-Powered-By: Next.js` | Tells attackers what to look up. | **Fixed.** `poweredByHeader: false`. | `web-headers.test.ts` |
| WEB-11 | Info | `.gitignore` gaps | Repository root | `storage/`, Playwright output and key files (`*.key`, `*.p12`) could be committed by accident. `.env*`, `.storage/` and `graphify-out/` were already covered. | **Fixed.** | n/a |
| WEB-12 | Info | Demo mode must stay off in production | `ZINNY_DEMO=1` | It shows one-click demo sign-ins, allows test-mode (free) payments and the development KYC key. The shareable preview guide sets it on purpose. | **Open**, deployment setting: never set it on a real deployment (now stated in `src/server/security/ENV.md`). | n/a |
| WEB-13 | Info | One key doubles as several | `CRON_SECRET` | It is also the fallback for signed file links, unsubscribe links and website sender fingerprints, so one leak affects all four. | **Open**, recommendation: set `STORAGE_SIGNING_SECRET`, `NOTIFICATIONS_SIGNING_SECRET` and `SITE_FINGERPRINT_SECRET` to their own values. | n/a |
| WEB-14 | Info | The "page not found" page runs without JavaScript | Unmatched addresses only | Next.js builds this page once, so it can't carry the per-request nonce and the policy blocks its scripts. The page still shows fully and its links work; the console lists the blocked scripts. | **Accepted.** Making it render per request would also stop institute websites from being cached. | n/a |

## Headers

Set on every response by `next.config.ts`, except the Content-Security-Policy, which `src/proxy.ts` sets per request because it carries a fresh nonce. Route handlers (files, downloads, JSON, webhooks) keep the policy they set themselves; the unsubscribe page and website images set stricter ones.

| Header | Value |
|---|---|
| `Content-Security-Policy` (pages rendered per request) | `default-src 'self'; script-src 'self' 'nonce-<random per request>' 'strict-dynamic' https://checkout.razorpay.com https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://lumberjack-cx.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Content-Security-Policy` (prerendered pages) | The same, with `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://www.youtube.com` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (`SAMEORIGIN` on `/api/storage/*` and the lesson PDF routes, which our own viewer frames) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), xr-spatial-tracking=(), idle-detection=(), browsing-topics=(), payment=(self <Razorpay>), fullscreen=(self <video players>), autoplay=(self <video players>), picture-in-picture=(self <video players>), encrypted-media=(self <video players>), clipboard-write=(self)` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (Razorpay's bank and UPI windows need their opener; pages that open Zinny can't keep a handle on it) |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Origin-Agent-Cluster` | `?1` |
| `X-Powered-By` | removed |

Notes:

- `style-src` allows inline styles: React renders `style=""` attributes and Next.js injects style tags. Styles can't run code.
- With `STORAGE_DRIVER=s3`, the bucket's origin (`S3_ENDPOINT`) is added to `media-src`, `connect-src` and `frame-src`, because videos and PDFs stream straight from it.
- In `next dev` only, `'unsafe-eval'` and the hot-reload websocket are added. Production has neither.
- Live classes open in the meeting app (Google Meet, Zoom) in a new tab, so camera and microphone stay off.
- Next.js 16 renamed middleware to "proxy": the file is `src/proxy.ts`.

**Browser check.** Production build (`next start`, production secrets set), headless Chromium. Zero CSP violations and every page hydrated on `/` (scrolled through the GSAP film), `/login`, `/marketplace` (and a search), `/demo/admin` (signed in as Asha, admin), `/demo/learn` (signed in as Riya, student, at 390 px). Also clean: `/book-a-demo`, `/signup/institute`, `/site/demo` and its blog, `/verify`, the admin website and certificates pages, the timetable, assignments, and lessons with a PDF (pdf.js rendered it), an uploaded video, a YouTube video and text. Signing in through the server action worked under the origin check. Cross-site `POST`s got 403; the 61st search in a minute got 429.

## Dependency audit

| | Critical | High | Moderate | Low |
|---|---|---|---|---|
| `npm audit --omit=dev`, before | 0 | 0 | 0 | 0 |
| `npm audit --omit=dev`, after | 0 | 0 | 0 | 0 |
| `npm audit` with development tools (for information) | 0 | 0 | 10 | 0 |

The 10 moderate advisories are in development tools only and never reach the deployed app: `esbuild` inside `@esbuild-kit` (used by `drizzle-kit`, which only runs on developer machines) and `minimatch` inside `typescript-eslint`. No package was added or upgraded; `package-lock.json` keeps every version pinned.

## Secrets scan

Clean. Checked the working tree and the full git history (about 400,000 lines of patches) for committed `.env` files, private keys (`BEGIN … PRIVATE KEY`), Razorpay live keys (`rzp_live_`), Stripe-style keys (`sk_`), AWS keys (`AKIA…`), GitHub and Slack tokens, JWTs, Resend keys, database URLs, and `password=`/`secret=`/`token=` assignments.

Only test material was found: Razorpay test ids (`rzp_test_ZinnyKey01`, `rzp_test_E2eZinnyKey`), AWS's documentation example key (`AKIAIOSFODNN7EXAMPLE`), HMAC test vectors, a placeholder `rzp_live_AbCdEf123456` in documentation, a test-fixture password, and local development database URLs with placeholder passwords. The only `.env` file ever committed is `.env.example`, with empty values. `.gitignore` covers `.env*` (except `.env.example`), `.storage/`, `storage/`, `graphify-out/`, `.vercel` and key files.

## Controls verified

These already worked and were tested rather than changed:

- **Rich text.** Blog posts, lesson text and assignment instructions are sanitised against short allow-lists. Tested with 16 attack strings each (script tags, event handlers, SVG and MathML tricks, `javascript:`/`data:`/`vbscript:` links in several encodings, forms, `<base>`, `<meta refresh>`). Lesson text and instructions are sanitised again on display.
- **Links.** Website links (social, map, LinkedIn), link lessons, meeting and recording links accept only `http(s)`. React 19 also neutralises any `javascript:` link that reaches a page.
- **Other HTML.** Certificates are drawn as SVG with every piece of text escaped and images inlined as PNG/JPEG data. Structured data (`ld+json`) escapes `<`. The email preview is a sandboxed iframe. No Markdown is rendered anywhere. Website images refuse SVG uploads.
- **Emails.** Template text and every demo-request field are HTML-escaped.
- **Open redirects.** `?next=` after sign-in accepts only paths on Zinny (no `//host`, `/\host`, control characters, `javascript:`, or anything over 500 characters). Every other redirect goes to a fixed path or one the server builds. "Return to panel" after support sign-in goes to a fixed path.
- **Rate limits already in place.** Wrong passwords (5 per address, 50 per network, in 15 minutes, doubling locks), phone codes (sending and guessing), password resets, sign-ups, institute sign-ups (5 an hour per network), demo requests, website enquiries and reviews, certificate look-ups. Hidden "honeypot" fields on the demo, student sign-up and website forms.
- **Server actions.** No `serverActions.allowedOrigins` is set, so Next.js only accepts actions from the site's own host.
- **Scheduled jobs and webhooks.** `/api/jobs/*` require `CRON_SECRET` with a constant-time comparison and refuse all calls when it is missing. The Razorpay webhook verifies its HMAC signature and refuses unsigned calls.
- **Cookies.** The consent cookie (`zinny_cookies`) holds only "1:essential" or "1:analytics"; the sidebar cookies (`zinny-sb-*`) hold "0" or "1". Neither carries personal data. The session cookie (identity's area) is `__Host-zinny_session`: `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`.
- **Errors.** Error pages show a generic message and a reference code only. Server actions return a generic message for anything that isn't an expected, user-facing error, and route handlers do the same. Next.js hides server error details in production.
- **Debug endpoints and source maps.** None found: the only API routes are jobs (secret), the Razorpay webhook (signature) and file storage (signed links). Browser source maps are off.
- **Vercel.** One daily cron (`/api/jobs/run?every=day` at 00:15 India time) in region `sin1`. The minute and hourly jobs need a paid Vercel plan or an outside scheduler sending `CRON_SECRET`.

## For other owners

- **Storage** (WEB-09): send `Content-Disposition: attachment` or a `sandbox` policy from `/api/storage/*` for anything but images, video and PDF.
- **Identity:** rate limits read the client's address from the first `X-Forwarded-For` entry. That is right on Vercel, which overwrites the header; behind any other proxy it must be configured to overwrite it too (already noted in `src/modules/identity/ENV.md`).
- **Certificates:** the public verify page's limiter is per server instance; a shared (Postgres) limit would hold across instances.
- **Data console:** not reviewed here (out of scope).

## Recommendations

1. **Vercel Firewall.** Turn on the managed rules and add rate-limit rules at the edge: `POST` to `/login`, `/signup`, `/reset`, `/join` and `/book-a-demo` at about 30 a minute per address, and `/marketplace?q=` at about 60 a minute. The in-app limits stay as a second layer. Enable Attack Challenge Mode during an attack.
2. **Bot protection on public forms.** Honeypots stop simple bots. If spam appears, add Cloudflare Turnstile to the institute sign-up, demo request and website forms (its script and frame host then go into the CSP).
3. **CSP reporting.** Add a `report-to` endpoint (or a service such as Sentry) to see blocked scripts in production, then consider Trusted Types once the two rich-text editors stop writing `innerHTML` directly.
4. **HSTS preload.** Once every subdomain of the production domain serves HTTPS, submit the apex domain at hstspreload.org (the header is ready).
5. **Secrets.** Store production secrets only in Vercel's encrypted environment variables, give each signing key its own value (WEB-13), and rotate them yearly and whenever someone with access leaves.
6. **Uptime and alerting.** Monitor `/login` and the daily job from outside, and alert on 5xx spikes, on the "Refusing requests" log line from the secrets check, and on failed Razorpay webhooks.
7. **Backups.** Turn on point-in-time recovery on the database (Neon or Supabase) with at least 7 days of history, and test a restore every quarter.
8. **Dependencies.** Run `npm audit --omit=dev` in CI and fail on high or critical, and turn on Dependabot or Renovate for security updates.
9. **Penetration test.** Before the first paying institute, commission an external test of authentication, multi-tenant isolation (one institute reading another's data), payments and file access.

## What changed

| File | Change |
|---|---|
| `src/proxy.ts` (new) | Production secrets check, cross-site write refusal, search rate limit, per-request CSP. |
| `src/server/security/csp.ts` (new) | Policies, route lists, fixed headers, Permissions-Policy. |
| `src/server/security/origin.ts` (new) | Cross-site write check. |
| `src/server/security/env.ts` (new) | Production secrets rules. |
| `src/server/security/rate-limit.ts`, `limits.ts` (new) | In-memory sliding window; Postgres-backed joining-code guard. |
| `src/server/security/check-static-csp.ts` (new) | Build check: runs after `npm run build` (`postbuild` in `package.json`). |
| `src/server/security/ENV.md` (new) | Production secrets in one place. |
| `next.config.ts` | Fixed security headers, `poweredByHeader: false`, browser source maps off. |
| `src/app/join/actions.ts`, `src/app/join/page.tsx`, `src/app/signup/page.tsx` | Joining-code lock-out. |
| `src/modules/website-builder/components/site/blog.tsx` | Sanitise blog HTML on render. |
| `.gitignore` | `storage/`, Playwright output, key files. |
| `tests/security/web-*.test.ts(x)` (new) | 5 files, 112 tests. |
