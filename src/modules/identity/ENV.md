# identity: environment variables

| Variable | Needed | What it does |
|---|---|---|
| `APP_URL` | **Production: yes** | The public address of the app, e.g. `https://app.zinny.in`. Used to build the links in invitation and password-reset emails. On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` (or `VERCEL_URL`) is used when it's missing; in development it defaults to `http://localhost:$PORT`. In production without any of these, sending an email with a link fails loudly (the event is retried) rather than sending a wrong link. |
| `AUTH_SECRET` | **Production: yes** | A long random string (`openssl rand -base64 48`). Keys the HMAC that stores 6-digit phone codes, so a copy of the database can't be used to work out a code. Falls back to `CRON_SECRET`, then to a development constant. Changing it only invalidates codes sent in the last 5 minutes. |
| `ZINNY_DEMO` | No | Existing. `1` shows the one-click demo accounts on `/login` in production. They're always shown in development. Only the listed demo accounts can be used this way. |

Also used, set by the platform: `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL` (see `APP_URL`), `NODE_ENV` (production turns on `Secure` and the `__Host-` cookie prefix, and bcrypt cost 12).

## Behind a proxy

Rate limits per network use the first address in `X-Forwarded-For`, then `X-Real-IP`. Vercel sets these itself. Behind another proxy, make sure it overwrites `X-Forwarded-For` rather than appending to what the client sent, or a client could pick its own address for rate limiting (per-email limits and lockouts still apply).

## Cookies

`__Host-zinny_session` (production) / `zinny_session` (development): the session. httpOnly, SameSite=Lax, path `/`, Secure in production. Lives for 30 days at most; the server ends it after 14 days without use.

`zinny_phone_signin`: a phone sign-in in progress (15 minutes). `zinny_uni`: the institute this device last signed in to, so `/login` can offer its phone tab. Both httpOnly.
