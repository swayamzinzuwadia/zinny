# website-builder environment variables

Both are optional. Nothing breaks without them.

| Variable | What it does | Default |
|---|---|---|
| `SITE_ORIGIN` | The public origin used for absolute links in `/site/<uni>/sitemap.xml` and `/site/<uni>/robots.txt`, e.g. `https://campus.zinny.in`. No trailing slash. | The request's own host (from `x-forwarded-host` / `host`). |
| `SITE_FINGERPRINT_SECRET` | Key for the HMAC of a sender's IP address, which the enquiry and review forms store for rate limiting (the IP itself is never stored). Set a long random value in production and keep it stable. | `CRON_SECRET`, then a fixed development value. |

Uploaded images use core `storage()`, so the storage variables in `docs/plan/contracts.md` section 7 apply (`STORAGE_DRIVER`, `S3_*`, `STORAGE_SIGNING_SECRET`).
