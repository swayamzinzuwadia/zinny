# notifications-delivery handoff

Branch `agent/notifications-delivery`, from `foundation-v1`. Port 3110. Screenshots are in `docs/handoff/notifications-delivery/`.

## Built

**Transports** (`index.ts`: `mailTransport`, `smsTransport`)
- Email goes through Resend (`POST /emails`).
  - Each request carries an idempotency key, the university's name as the sender ("Demo University via Zinny"), a reply-to address, a kind tag and one-click unsubscribe headers (RFC 8058).
- SMS goes through MSG91's Flow API with DLT templates.
  - Template ids come per kind: the university's own setting first, then `MSG91_SMS_TEMPLATES`. A text with no template id fails with a message naming the kind.
- WhatsApp goes through MSG91 templates, behind the same text-provider interface.
- Without keys, messages print to the console, as before.
- Sends are paced to each provider's rate limit. Errors are sorted into retryable (429, 5xx, timeouts, throttling) and permanent.
- Every environment variable, plus Resend domain and MSG91 DLT setup, is in `src/modules/notifications-delivery/ENV.md`.

**Direct sends.** When another module calls `sendEmail` or `sendSms` with a `universityId`, the message is:
- branded and logged in `notif_deliveries`;
- checked against unsubscribes and the admin's settings;
- held during quiet hours (texts only);
- retried by the job if it fails.

Security kinds (`security.*`, or kinds ending in otp, reset, invite and similar):
- ignore quiet hours and opt-outs and carry no unsubscribe link;
- never store their text;
- are tried once, and throw on failure so the caller can tell the person.

**Delivery job** `notifications-delivery.deliver` (every minute)
- Each new core notification is claimed once, through the primary key of `notif_dispatches`.
- It becomes one row per allowed channel in `notif_deliveries`, unique on (notification, channel).
- Each row is then claimed with a conditional update, so overlapping runs never send it twice.
- Retries wait 1 min, 5 min, 30 min, then 2 h. After 5 attempts the row is marked failed.
- A send interrupted by a crash is repeated only through Resend's idempotency key. Otherwise it is marked failed, so nothing arrives twice.
- `notifications-delivery.cleanup` (daily) deletes finished records older than 180 days.

**Templates**
- Every core kind has defaults: subject, body and SMS text, with `{{variables}}`.
- Emails have an HTML version and a plain-text version, in a branded layout with the university's name, logo and colour, plus a button to the right page.
- Other modules' kinds fall back to a generic template built from the notification's title and body.

**Pages**
- `/[uni]/admin/settings/notifications` (`settings.manage`), with four tabs:
  - **Notifications:** each kind's channels (on, optional or off) and text, MSG91 and WhatsApp template ids, a live preview, test sends and "Restore defaults".
  - **Delivery log:** filters, and "Send again" for failed messages.
  - **Setup:** provider status and the reply-to address.
  - **My notifications** (`self.profile`): staff see only this tab.
- `/[uni]/learn/settings/notifications`: the learner's own switches, within what the admin allows.
- `/[uni]/learn/settings/notifications/unsubscribe`: a signed per-kind link that works without signing in. Opening it (GET) only shows the page; the change happens on POST, including one-click.

**Rules** for quiet hours (9 pm to 8 am in the university's time zone) and unsubscribe links are covered by tests.

**Seed**
- Reply-to address, three customised kinds and a security template id.
- Preferences for Riya, Kabir and Hema.
- A delivery log with sent, failed (a bounced address), skipped and waiting messages.

**Tests:** 70 in `tests/notifications-delivery/`. The full suite has 219 tests, all passing.

## Not built (and why)
- **Push, marketing and bulk messages, inbound replies:** out of scope.
- **Delivery receipts** (Resend and MSG91 webhooks for bounces and complaints): they need a public route under `src/app/api/`, which I don't own. Bounces show only when the provider refuses at send time. See the request below.
- **SMS for staff kinds** is off by default. Admins can turn it on.

## Contracts used / provided
- **Provides:** `mailTransport`, `smsTransport`.
  - Jobs `notifications-delivery.deliver` (minute) and `notifications-delivery.cleanup` (day).
  - A seed.
- **Uses:**
  - core `notifications` (read only), `users.phone` and `role_assignments` (read only);
  - `withTenant`, `audit`, `assertCan`/`can`, `universityLite`, `peopleLite`, `systemActorFor`.
- **No events or slots.**
- **Module index:** `index.ts` loads the delivery code lazily. An eager import forms a cycle (core → registry → module) that made the registry see this module as `undefined` when a test imported the module first.

## New packages
None. The Resend and MSG91 clients use `fetch`.

## New environment variables
All are optional. See `ENV.md`:
- `APP_URL`, `NOTIFICATIONS_SIGNING_SECRET` (falls back to `CRON_SECRET`; one of them is required in production)
- `NOTIFICATIONS_SEND_CONCURRENCY`, `NOTIFICATIONS_EMAIL_PER_SECOND`, `NOTIFICATIONS_TEXT_PER_SECOND`
- `RESEND_API_KEY`, `MAIL_FROM`, `RESEND_BASE_URL`
- `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_SMS_TEMPLATES`, `MSG91_WHATSAPP_NUMBER`, `MSG91_WHATSAPP_LANGUAGE`, `MSG91_BASE_URL`

## Requests for other owners
1. **Core (admin menu):** add "Notifications" (`/settings/notifications`) under Settings in `src/server/authz/menu.ts`. Give HOD and faculty a way to reach it too, for their own "My notifications"; today they can only reach it by URL.
2. **Core (learner nav):** link `/[uni]/learn/settings/notifications` from the avatar menu in `src/app/[uni]/learn/layout.tsx`.
3. **Identity:**
   - Send codes and resets with kinds `security.otp` and `security.reset`, and invites with `identity.invite`, always passing `universityId` when there is one.
   - Show the notification settings link on the profile page. The pages link to `/[uni]/profile` for adding a mobile number.
4. **Integrator:**
   - A public webhook route (for example `src/app/api/notifications/[provider]/route.ts`) for Resend and MSG91 delivery receipts, to mark bounces.
   - Schedule `/api/jobs/run?every=minute` in production.
5. **Other modules:** pass `kind` (and `data.link` as a `/<uni>/…` path) in `notify()`, so emails get a button and admins can set each kind's channels.

## Known issues
- The delivery window is 24 hours. Notifications older than that are never sent, by design, so an outage doesn't send stale news.
- Pacing is per server process. Several instances could together exceed the provider's rate; 429 responses are retried.
- A person's phone number is read from `users.phone`. If an identity profile change lands during an SMS's quiet-hours wait, the queued text keeps the old number.
- Screenshots: full-page captures don't render the email preview iframe below the fold. `admin-email-preview-tablet.png` shows it in view.
