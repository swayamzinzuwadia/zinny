# notifications-delivery: environment variables

All are optional. Without any keys, email and texts are printed to the server log (the
console transports), so development and tests never reach a real provider.

## App

| Variable | Example | What it does |
|---|---|---|
| `APP_URL` | `https://app.zinny.in` | Public base URL. Every link in an email or text (buttons, unsubscribe, settings) starts with it. Falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL`, then `http://localhost:$PORT`. **Set it in production.** |
| `NOTIFICATIONS_SIGNING_SECRET` | 32+ random characters | Signs unsubscribe links. Falls back to `CRON_SECRET`. Required in production (one of the two); changing it makes every unsubscribe link already sent stop working. |
| `NOTIFICATIONS_SEND_CONCURRENCY` | `2` | Messages sent at the same time per university during a job run (1 to 8). |
| `NOTIFICATIONS_EMAIL_PER_SECOND` | `2` | Most Resend requests per second from one server process (Resend's default account limit is 2). Raise it when Resend raises yours. |
| `NOTIFICATIONS_TEXT_PER_SECOND` | `10` | Most MSG91 requests per second from one server process. |

## Email: Resend

| Variable | Example | What it does |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | Turns on Resend. A sending-only key is enough. |
| `MAIL_FROM` | `Zinny <notifications@mail.zinny.in>` | Sender address, on a domain verified in Resend. The display name becomes "<University> via Zinny" for each university's messages. Default `Zinny <notifications@mail.zinny.in>`. |
| `RESEND_BASE_URL` | `https://api.resend.com` | Only for a proxy or tests. |

## SMS and WhatsApp: MSG91

| Variable | Example | What it does |
|---|---|---|
| `MSG91_AUTH_KEY` | `4123…` | Turns on MSG91 for SMS (and WhatsApp when the number below is set). |
| `MSG91_SENDER_ID` | `ZINNYE` | Six-letter DLT header (sender id). Optional when each MSG91 template carries its own. |
| `MSG91_SMS_TEMPLATES` | `{"security.otp":"6650…","security.reset":"6650…","default":"6650…"}` | MSG91 template ids per notification kind, used for every university that hasn't set its own on the settings page. `default` is used for any kind without one. JSON. |
| `MSG91_WHATSAPP_NUMBER` | `919800000000` | The WhatsApp business number connected in MSG91, with country code. Without it WhatsApp messages fail with a clear message. |
| `MSG91_WHATSAPP_LANGUAGE` | `en` | Language code of the approved WhatsApp templates. Default `en`. |
| `MSG91_BASE_URL` | `https://control.msg91.com` | Only for a proxy or tests. |

## Cron

The delivery job is a module job, so the existing cron call runs it:

- `GET /api/jobs/run?every=minute` with `Authorization: Bearer $CRON_SECRET`: plans and sends deliveries.
- `GET /api/jobs/run?every=day`: deletes delivery records older than 180 days.

## Provider setup

### Resend (email)

1. Create a Resend account and add a sending domain, preferably a subdomain such as `mail.zinny.in`, so the main domain's reputation is separate.
2. Add the DNS records Resend shows: the DKIM `TXT` record (`resend._domainkey`), the SPF `TXT` record and the `MX` record on the `send` subdomain. Wait until Resend shows the domain as verified.
3. Add a DMARC record for the domain, starting with `v=DMARC1; p=none; rua=mailto:dmarc@zinny.in`, and tighten it to `quarantine` once reports look clean.
4. Create an API key with "Sending access" for that domain and set `RESEND_API_KEY`. Set `MAIL_FROM` to an address on the verified domain.
5. Send a test from Settings, Notifications, any notification, "Send test email".

Every message carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers (one-click unsubscribe, RFC 8058), which Gmail and Yahoo expect from bulk senders. Security messages carry neither.

### MSG91 (SMS, India DLT)

Indian SMS must use a sender id (header) and message templates registered on a DLT portal (Jio, Vodafone Idea, Airtel, BSNL…) under your organisation's Principal Entity id.

1. Register the organisation as a Principal Entity on a DLT portal and get the entity id.
2. Register a six-letter header (sender id), such as `ZINNYE`, category "Transactional" (or "Service implicit").
3. Register one content template per notification kind. Use the default text from Settings, Notifications as the starting point, with DLT variables (`{#var#}`) where the template has `{{…}}`. Register the security templates (`security.otp`, `security.reset`) as "Transactional" so they are delivered at any hour and to numbers on the do-not-disturb list.
4. In MSG91, add the DLT entity id, the header, and each template with its DLT template id. MSG91 gives each one its own template id. Name its variables after Zinny's: `name`, `firstName`, `title`, `body`, `university`, `link`, `text` (the whole rendered message) and, for codes, `code`.
5. Set `MSG91_AUTH_KEY` and `MSG91_SENDER_ID`. Put the MSG91 template ids either in `MSG91_SMS_TEMPLATES` (for every university) or in each notification's "MSG91 template id" field in Settings, Notifications (for one university). A text with no template id fails with a message saying which kind needs one.

### MSG91 (WhatsApp, optional)

1. Connect a WhatsApp Business number in MSG91 and set `MSG91_WHATSAPP_NUMBER`.
2. Get a template approved per notification kind. Its body gets four values in order: `{{1}}` first name, `{{2}}` headline, `{{3}}` institute name, `{{4}}` link.
3. Enter each template's name in that notification's "WhatsApp template name" field.
