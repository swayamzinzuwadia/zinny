# identity: environment variables

| Variable | Needed | What it does |
|---|---|---|
| `APP_URL` | **Production: yes** | The public address of the app, e.g. `https://app.zinny.in`. Used to build the links in invitation and password-reset emails. On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` (or `VERCEL_URL`) is used when it's missing; in development it defaults to `http://localhost:$PORT`. In production without any of these, sending an email with a link fails loudly (the event is retried) rather than sending a wrong link. |
| `AUTH_SECRET` | **Production: yes** | A long random string (`openssl rand -base64 48`). Keys the HMAC that stores 6-digit phone codes, so a copy of the database can't be used to work out a code. Falls back to `CRON_SECRET`. A production build with neither refuses to send or check codes; only development uses the built-in constant. Changing it only invalidates codes sent in the last 5 minutes. |
| `TRUSTED_PROXY_HOPS` | No (default `1`) | How many proxies in front of the app append the caller's address to `X-Forwarded-For`. The address that many entries from the right is used for per-network limits and the sessions list; anything further left was sent by the caller and is ignored. `1` is right for Vercel and for one AWS load balancer; use `2` for CloudFront in front of a load balancer. |
| `ZINNY_DEMO` | No | Existing. `1` shows the one-click demo accounts on `/login` in production. They're always shown in development. Only the listed demo accounts can be used this way, and on a production build not one with a Zinny team role (those sign in with their password, and the page says so) unless `ZINNY_DEMO_TEAM` is also set. Never set it on a deployment with real data. |
| `ZINNY_DEMO_TEAM` | No | `1`, together with `ZINNY_DEMO=1`, also shows the Zinny team demo accounts (Super Admin, Support Agent) as one-click buttons on a production build. **Anyone who can open that site's sign-in page then becomes Super Admin in one click**: every institute, sign in as anyone, team roles. Use it only on a private demo deployment (behind a password or IP allowlist), never on one anyone can reach and never with real data. Off by default; development always shows them. |

Also used, set by the platform: `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL` (see `APP_URL`), `NODE_ENV` (production turns on `Secure` and the `__Host-` cookie prefix, and bcrypt cost 12).

## Behind a proxy

Rate limits per network use the address `TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For` (the last one by default), then `X-Real-IP` when there is no `X-Forwarded-For`. Vercel replaces the header with the caller's address; an AWS load balancer appends it. Either way a caller can't choose the address their attempts are counted against (per-email limits and lockouts apply in any case).

## Cookies

`__Host-zinny_session` (production) / `zinny_session` (development): the session. httpOnly, SameSite=Lax, path `/`, Secure in production. Lives for 30 days at most; the server ends it after 14 days without use. A session started with a phone code counts only inside the institute where the code was entered.

`zinny_phone_signin`: a phone sign-in in progress (15 minutes). `zinny_uni`: the institute this device last signed in to, so `/login` can offer its phone tab. Both httpOnly.
