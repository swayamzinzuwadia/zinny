# Zinny security review: data access, endpoints and files

Scope: how data is stored and reached. That covers row-level security in Postgres, every use of the owner (bypass) connection, the Super Admin data console, SQL construction, every route handler, file upload and download, record-level access (IDOR), and secrets and personal data at rest. Sign-up, roles and sessions belong to the auth review, and headers, CSP and dependencies to the web review. Issues found in those areas are listed here for their owners.

Reviewed at commit `b2d71f6`. Fixes are on branch `worktree-agent-acc7311b3bf707f24`.

## Summary

| Severity | Found | Fixed | Open |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High | 1 | 1 | 0 |
| Medium | 6 | 5 | 1 |
| Low | 5 | 2 | 3 |
| Informational | 2 | 0 | 2 |
| **Total** | **14** | **8** | **6** |

**Can anyone query the database directly from an endpoint?** No.

- No endpoint, page or server action accepts SQL. Every query is built with Drizzle, and every value goes to Postgres as a bound parameter.
- Only two places put text into SQL themselves. Neither takes that text from the request. One is a fixed date unit in analytics. The other is the data console, which uses only table, column and type names it has read from Postgres's own catalogue.
- Institute users reach the database only through the app role, `zinny_app`. Row-level security binds that role on every table, so a query that forgets its filter still sees only its own institute.
- The owner connection skips row-level security. It is used only for:
  - sign-in;
  - the Zinny team panel, after a permission check;
  - background jobs and the payment webhook, behind a secret or a signature;
  - cross-institute reads in the marketplace.

**Before this review there was one way to reach the database directly: DATA-01.** The policy script took privileges away from the app role only. It left every other database role alone, and 17 tables had no row-level security at all. Zinny lists Supabase as a hosting target. On a default Supabase project, the public REST API (the `anon` key, which ships to browsers) can read and write any table that its roles have been granted. That would have included `sessions`. Writing a row there signs you in as any user, including a Super Admin. The script now:

- takes back every grant except the app role's;
- forces row-level security on all 127 tables;
- refuses to deploy if the app role could get around row-level security.

**Can a user of institute A read institute B's data?** Not through any endpoint we tested.

- Every service gets its institute from the signed-in person's actor. It sets the institute in a transaction-local, parameterised setting, and checks permissions against the roles that person holds in that institute.
- Opening institute A's address while signed in to institute B produces an actor with no roles in A. Every permission check then fails.
- The IDOR tests in `tests/security/data-idor.test.ts` try this with invoices, orders, people lists, reports, data exports, KYC, PAN-card documents and privacy requests. Every attempt is refused.

## Findings

| ID | Severity | Title | Where | Impact | Status | Test |
| --- | --- | --- | --- | --- | --- | --- |
| DATA-01 | High | Other database roles kept their grants, and 17 tables had no row-level security | `src/db/policies.sql:56-83` (before the fix) | The script revoked privileges from `zinny_app` only. Grants to PUBLIC, or from a provider's default privileges (Supabase gives all tables to `anon` and `authenticated`), stayed in place. On such a host, the public REST API could read and write `sessions`, `idn_tokens`, `idn_sessions`, partner contacts and the breach register. Writing a session row is an account takeover, Super Admin included. | Fixed: every grant to any role other than the owner and `zinny_app` is revoked on each `db:push`. Every table without `university_id` now has forced row-level security and no policy, so it is deny-all. | `data-rls.test.ts` "grants a hosting provider's API role picked up … are taken back", "PUBLIC holds nothing", "every other table is forced too" |
| DATA-02 | Medium | Row-level security was enabled but not forced, and nothing checked the app role | `src/db/policies.sql:56,87,97` (before the fix) | Whether the owner skipped row-level security depended on who owned each table, not on an explicit role setting. Nothing stopped `zinny_app` from being a superuser, having BYPASSRLS, owning tables or belonging to the owner role. Nothing stopped `DATABASE_URL` from pointing at the owner. Any of these would silently remove isolation between institutes. | Fixed: `FORCE ROW LEVEL SECURITY` is on all 127 tables. The policy script refuses to run if `zinny_app` is a superuser, has BYPASSRLS, owns a table or belongs to the owner role, or if the owner has neither SUPERUSER nor BYPASSRLS. `npm run db:push` and the Vercel deploy step (`scripts/deploy-db.ts`) refuse a `DATABASE_URL` that would get around row-level security (`verifyAppRole`, `scripts/db-push.ts`). | `data-rls.test.ts` "has row-level security enabled and forced", "is not a superuser, has no BYPASSRLS …", "a deploy refuses a DATABASE_URL that would bypass row-level security" |
| DATA-03 | Low | App role could change every column of `users` and `universities` | `src/db/policies.sql:93,108` (before the fix) | Any code path running inside an institute could, at the database level, change a person's id, or lift its own institute's suspension or freeze, or change its slug and trial dates. No current code does this. | Fixed: column-level grants. On `universities` the app role may update only `gst_enabled`. On `users` it may update only `name`, `email`, `phone` and `password_hash`. Everything else goes through the core API on the owner connection. | `data-rls.test.ts` "gets select/insert/update/delete on tenant tables … and nothing else"; `tests/core/rls-coverage.test.ts` updated to expect column grants |
| DATA-04 | Medium | The data console showed and searched KYC data | `src/modules/zinny-team-panel/data-console.ts:121` | The pattern for secret columns matched only hash, secret, token and password. A Super Admin saw the encrypted PAN (`onb_student_kyc.pan_cipher`) and Aadhaar digits, could search, filter and sort on them, could edit them, and changes were logged in full. | Fixed: encrypted values, Aadhaar, one-time codes, nonces, salts and API or private keys are now secret columns. They are masked, can't be searched, filtered, sorted or set, and are masked in the activity log. | `data-console.test.ts` "KYC data is masked like credentials" (4 tests) |
| DATA-05 | Medium | The data console could rewrite the audit trail | `data-console.ts:799,843,894` | A Super Admin could edit or delete `audit_log` rows, including the console's own `plat.data.*` entries, and `domain_events`. That would erase the record of what they did. | Fixed: both tables are read only in the console, both in the service (`READ_ONLY_TABLES`) and in the UI. They match the app role, which may only append to them. | `data-console.test.ts` "the audit trail can't be rewritten from the console" |
| DATA-06 | Medium | Forgeable file links in production without a signing secret | `src/contracts/storage.ts:60`, `src/app/api/storage/[...key]/route.ts` | The local storage driver falls back to a fixed secret written in the source when neither `STORAGE_SIGNING_SECRET` nor `CRON_SECRET` is set. In such a deployment, anyone could sign a link to any institute's files: PAN cards, KYC documents, submissions and invoices. | Fixed: in production, `/api/storage` serves nothing until a real secret is set, and returns 503 with a clear message. | `data-endpoints.test.ts` "in production, serves nothing until a real signing secret is set", "refuses a forged, altered or expired one" |
| DATA-07 | Low | Stored files were served inline with their stored type | `src/app/api/storage/[...key]/route.ts:28-33` (before the fix) | A link without a download name served the file inline as whatever type it was saved with. A stored HTML or SVG file would have run on Zinny's own origin as stored cross-site scripting. Today no upload stores those types inline (assignment HTML is saved as text and always downloaded), so this is defence in depth. | Fixed (`src/server/storage-serve.ts`): only PDF, raster images, audio and video open inline. Anything else is sent as `application/octet-stream` with `attachment`. Every response has `nosniff`. Everything except PDF, audio and video also gets `Content-Security-Policy: default-src 'none'; sandbox`. File names are cleaned for the header. | `data-endpoints.test.ts` "never serves an HTML or SVG file as a page", "opens PDFs, images and video inline" |
| DATA-08 | Medium | Demo data could be seeded into production | `src/db/seed.ts:31,364` | `npm run db:seed` against a production database would create the Super Admin `zara@zinny.demo` and about 150 accounts, all with the password `zinny123`. | Fixed: `seedDemo()` and the script refuse when `NODE_ENV` or `VERCEL_ENV` is production, unless `ZINNY_DEMO=1`. | `data-endpoints.test.ts` "the seed refuses production unless it is a demo deployment" |
| DATA-09 | Low | The KYC key falls back to a development key on demo deployments | `src/modules/onboarding/lib/crypto.ts:13-16` | With `NODE_ENV=production` and `ZINNY_DEMO=1`, PANs are encrypted with a key derived from a string in the source. Real PANs entered on a demo site can be decrypted by anyone with a copy of the database. Ciphertexts are also not bound to their row (no AAD). | Open (owner: onboarding) | — |
| DATA-10 | Medium | Adding a person by email reveals another institute's member | `src/server/services/users.ts:277-300`, `users` policy in `src/db/policies.sql` | If an institute admin adds an email that already has a Zinny account elsewhere, the role is attached at once, without that person agreeing. The admin's institute can then see the person's name, email and phone. Anyone whose email is known can be looked up this way. Under the DPDP Act this is a disclosure without consent. | Open (owner: identity and core). Recommendation: until the person accepts an invitation, show only what the inviting institute typed. | — |
| DATA-11 | Low | People stay visible after their role ends | `users` policy `visible_users` | The policy counts any role assignment, including revoked and expired ones. A former student's name, email and phone stay visible to the institute for good. | Open (owner: core). Decide whether history needs the whole profile or only the name. | — |
| DATA-12 | Low | Fixed fallback secrets in auth and rate limiting | `src/server/auth/tokens.ts:22`, `src/modules/website-builder/rate-limit.ts:22` | Without `AUTH_SECRET` or `CRON_SECRET`, one-time-code HMACs use a constant written in the source. With a copy of the database, every 6-digit code can then be brute-forced offline. The website fingerprint secret works the same way. | Open (owners: auth, website-builder). Recommendation: refuse to start in production without the secret, as `kycKey()` and the notifications module already do. | — |
| DATA-13 | Info | Lifetime of signed links | `storage().signedUrl` callers | Signed links are bearer links that work for anyone who has them, for a fixed time: documents and assignment files 2 min, certificates 5 min, lesson PDFs 30 min, lesson videos up to 6 h, profile photos 1 h. Anyone holding a link to a paid video can share it for that window. | Open (owner: content-progress). Shorter video links, or links tied to the session, if paid content matters more. | — |
| DATA-14 | Info | No runtime check that the app connection is bound | `src/server/tenant.ts` | Deploys now check the role behind `DATABASE_URL` (DATA-02), but a running server doesn't. | Open (owner: core). Recommendation: a one-time check in `withTenant` that `current_user` has neither SUPERUSER nor BYPASSRLS and owns no table. | — |

## Controls verified

**Row-level security coverage.**

- 127 tables, all with row-level security enabled and forced.
- 110 of them hold university data. Each has exactly one policy, `tenant_isolation` (all commands, PUBLIC), with `university_id = zinny_current_university()` in both USING and WITH CHECK.
- 15 more have no policy, which makes them deny-all.
- `users` and `universities` have their own policies.
- Evidence: `tests/security/data-rls.test.ts` reads `pg_class` and `pg_policy` and fails on any drift. It also checks that the new `onb_*`, `dpdp_*` and `plat_seat_packs` tables are covered.

**Without an institute set, the app sees nothing.**

- With no tenant set, `zinny_app` sees 0 rows in all 110 tables, in `users` and in `universities`.
- It can't insert a row for any institute.
- Evidence: `data-rls.test.ts`.

**The app role, `zinny_app`.**

- NOSUPERUSER and NOBYPASSRLS, no CREATEROLE or CREATEDB, owns nothing, is not a member of the owner role, and has no CREATE on `public`.
- It can execute only `zinny_current_university`, `zinny_current_user` and `zinny_upsert_user`. PUBLIC can execute nothing.
- Its grants are exactly select, insert, update and delete on tenant tables (select and insert on `audit_log` and `domain_events`), plus the column grants from DATA-03.
- Evidence: `data-rls.test.ts`.

**The institute comes only from the session.**

- `withTenant` sets `app.university_id` and `app.user_id` with `set_config(…, true)`. The values are bound parameters and the setting ends with the transaction.
- `zinny_current_university()` turns an empty or missing value into NULL, which matches no rows.
- A university id containing SQL is rejected as an invalid uuid, and the SQL never runs.
- After a transaction, the next query on the pool has no institute set.
- Evidence: `data-rls.test.ts` "the tenant id is a bound parameter …", "the tenant is local to the transaction".

**No Zinny team roles from inside an institute.**

- A platform role must have no university (a CHECK constraint on `role_assignments`), and row-level security refuses a row without the current university. So no institute code path can create a Super Admin, even by writing to the table directly.
- Evidence: `data-rls.test.ts`.

**Owner connection (`systemDb()`): 24 files reviewed.** Each use is either reachable only after a permission check, or reachable only through a secret, a signature or a token:

- sign-in: `identity/auth.ts`, `server/auth/*`, `server/actor.ts`;
- Zinny team panel and core-api platform functions: `assertPlatform` or `assertSuperAdmin` comes first;
- marketplace: reads only, by design;
- privacy `services/system.ts`: platform-permission checked;
- payments bundles: owner-scoped by `userId`;
- certificates verify: public lookup by exact code, which returns no other data;
- jobs and the events drain: cron secret;
- onboarding: core API.

**Data console.**

- It can't run arbitrary SQL. Table and column names are looked up in `pg_catalog` and quoted with `sql.identifier`. The sort direction is `asc` or `desc` only. Values are bound and cast to the type the catalogue gives. Row keys are checked against that type, or against a regex for `ctid`.
- Only a Super Admin with a current assignment gets in. Every other team role, institute admins and a Super Admin whose assignment has ended are all refused. Every exported function checks first.
- Evidence: `tests/data-console/data-console.test.ts` and `tests/security/data-console.test.ts`, which include injection attempts on table, sort and filter names.

**SQL injection.** No user input reaches SQL as text anywhere:

- 2 uses of `sql.raw` (a fixed analytics unit, and the data console's catalogue type names and checked sort direction);
- 0 string-based `.execute()` calls;
- `LIKE` searches escape `%`, `_` and `\`;
- report filters are typed and parameterised.

**Cron endpoints** (`/api/jobs/run`, `/api/jobs/events`):

- `Authorization: Bearer $CRON_SECRET` with `timingSafeEqual`;
- closed when the secret is unset;
- an unknown schedule is refused before anything runs.
- Evidence: `data-endpoints.test.ts`.

**Payment webhook** (`/api/payments/razorpay`):

- HMAC-SHA256 checked with `timingSafeEqual`;
- refused while Razorpay isn't configured;
- bodies over the size limit refused;
- idempotent through unique `event_id` and `body_sha256` claims, with stale claims retried;
- the institute is resolved from the order, never from the request;
- test-mode payments are off in production unless `ZINNY_DEMO=1`.
- Evidence: `tests/payments/webhook.test.ts`, `data-endpoints.test.ts`.

**Searches** (`/platform/search`, `/platform/institutes/search`):

- both need a session, then `isZinnyTeam` or `platform.manage_universities`;
- people search is for Super Admins only;
- the search term is escaped for `LIKE`.
- Evidence: `data-idor.test.ts` "the Zinny team searches stay closed to institute users".

**Uploads.**

- File types are checked by their bytes for institute documents (PDF, JPG or PNG) and for lesson files (PDF, MP4, WebM or MOV).
- Website images and profile photos are re-encoded to WebP. SVG is refused.
- Certificate signature images are checked to be PNG or JPEG.
- Assignment files use an extension allowlist; HTML is saved as text and always downloaded.
- Sizes are checked per part and in total.
- Storage keys must be `<uuid>/<module>/…`, with no `..`, and the path must resolve inside the storage folder.
- Evidence: module tests, and `data-endpoints.test.ts` "refuses keys that leave the institute's folder".

**Downloads check who is asking.**

- Invoices: the buyer, or `finance.view`.
- Certificates: the holder, or `cert.view` on their batch.
- Assignment files: the student, or a grader of their batch.
- Institute documents: `settings.manage`, or `platform.manage_universities` under the right institute.
- Everyone else gets "not found".
- Evidence: `data-idor.test.ts` and the module tests.

**Password hashes stay on the server.**

- They never reach client props. Services return only a boolean `hasPassword`, and `loadActor` copies only the id, name and email.
- The data console masks `password_hash` and every other `*hash` column.

**PAN.**

- Encrypted with AES-256-GCM and a random IV. Production refuses to start without `KYC_ENCRYPTION_KEY`, except on demo deployments (DATA-09).
- Never decrypted anywhere in the app. Shown only as `XXXXX1234F`.
- The audit entry holds only the masked PAN and "Aadhaar given or not given".

**Audit and event logs don't store secrets.**

- Searching the seeded database for tokens, reset or invite links, and passwords in `audit_log`, `domain_events`, `notifications` and `notif_deliveries` found 0 matches. Security emails are stored redacted.
- The console masks secrets in its own log entries.

## Endpoint inventory

"Space" means `spaceContext(slug)`: it needs a session (or redirects to sign-in), builds the actor for that institute from the person's own roles, and blocks changes while viewing as someone. "Platform" means `platformContext()` or `currentUserId()` with `loadActor(userId, null)`.

| Route | Methods | Who can call it | What it checks |
| --- | --- | --- | --- |
| `/api/jobs/run` | GET | Scheduler | `CRON_SECRET` bearer token (constant time); `every` is minute, hour or day |
| `/api/jobs/events` | GET | Scheduler | `CRON_SECRET` bearer token |
| `/api/payments/razorpay` | POST | Razorpay | Size limit, HMAC signature, idempotent claim, institute taken from the order |
| `/api/storage/[...key]` | GET | Anyone holding a signed link | HMAC over key, expiry and name; expiry checked; key validation; production needs a secret; safe headers (DATA-06, DATA-07) |
| `/platform/search` | GET | Zinny team | Session, then `isZinnyTeam`; each group checks its own permission |
| `/platform/institutes/search` | GET | Zinny team | Session, then `platform.manage_universities` |
| `/platform/billing/[id]/pdf` | GET | Zinny finance | Platform, then `platform.finance`; uuid checked |
| `/platform/signups/[universityId]/documents/[id]` | GET | Account managers, Super Admin | Platform, then `platform.manage_universities`; document read under that institute's row-level security; 2-minute link |
| `/platform/support/log/export` | GET | Support agents, Super Admin | Platform, then `platform.support_mode`; CSV cells protected against spreadsheet formulas |
| `/privacy/my/export` | GET | Any signed-in person | Session; only the person's own data that Zinny holds |
| `/[uni]/profile/privacy/export` | GET | Member of the institute | Space, then `self.profile`; own data only |
| `/[uni]/admin/choose-plan/documents/upload` | POST | Institute leadership | Space, then `settings.manage`; only the uploader can finish; checks kind, size and bytes |
| `/[uni]/admin/choose-plan/documents/[id]` | GET | Institute leadership | Space, then `settings.manage`; row-level security; 2-minute link |
| `/[uni]/admin/finance/invoices/[invoiceId]/pdf` | GET | Finance staff, buyer | Space, then the buyer or `finance.view`; anyone else gets 404 |
| `/[uni]/admin/finance/invoices/export` | GET | Finance staff | Space, then `finance.view`; protected CSV |
| `/[uni]/admin/finance/sales/export` | GET | Finance staff | Space, then `finance.view`; protected CSV; logged |
| `/[uni]/admin/finance/sales/invoices/[invoiceId]` | GET | Finance staff, buyer | As the invoice PDF |
| `/[uni]/admin/finance/reports/download` | GET | Report readers | Space, then `runReport`: report access and reach |
| `/[uni]/admin/products/assignments/upload` | POST | Staff with `assignment.manage`, graders | Space, then permission per purpose; per-person limit on unsaved uploads |
| `/[uni]/admin/products/assignments/files/[fileId]` | GET | Staff who can view or grade | Space, then `fileLink` access rules; logs who opened it; 2-minute link |
| `/[uni]/admin/products/batches/[id]/attendance/[date]/start` | POST | Batch faculty | Same-origin check, Space, then `startClass` permission |
| `/[uni]/admin/products/batches/[id]/timetable.csv` | GET | Staff who can view the batch | Space, then `getBatchPlan` permission; protected CSV |
| `/[uni]/admin/products/certificates/issued/[id]/download` | GET | Staff with `cert.view` | Space, then holder or `cert.view` |
| `/[uni]/admin/products/certificates/templates/[id]/sample` | GET | Certificate staff | Space, then `assertSee` |
| `/[uni]/admin/products/content/uploads` | POST | Course editors | Space, then `content.manage` on the lesson's course |
| `/[uni]/admin/products/content/uploads/[uploadId]` | PUT, POST | The editor who started the upload | Space, then `content.manage`; uploader only; first-part bytes checked |
| `/[uni]/admin/products/content/lessons/[lessonId]/file` | GET | Course staff | Space, then `course.view` on the lesson's course (`staffLessonFileUrl`); 30-minute link |
| `/[uni]/admin/website/upload` | POST | Website editors | Same-site check, Space, then website permission; 10 MB limit; re-encoded |
| `/[uni]/learn/assignments/upload` | POST | Students | Space, then `self.submit_assignment` and a seat in the batch |
| `/[uni]/learn/assignments/files/[fileId]` | GET | The student, or graders | Space, then `fileLink` |
| `/[uni]/learn/certificates/[id]/download` | GET | The holder | Space, then holder (revoked certificates refused) or `cert.view` |
| `/[uni]/learn/invoices/[invoiceId]` | GET | The buyer | Space, then the buyer with `self.view_invoices`, or finance |
| `/[uni]/learn/lessons/[lessonId]/file` | GET | Enrolled learners | Space, then `self.learn` and the lesson open to them (`openAccess`) |
| `/[uni]/learn/lessons/[lessonId]/progress` | POST | Enrolled learners | Space, then the learner's own progress |
| `/[uni]/learn/settings/notifications/unsubscribe` | GET, POST | Anyone holding a signed link | Signed token tied to this institute; strict CSP |
| `/site/[uni]/media/[id]` | GET | Public | Active institute only; uuid checked; media read under that institute's row-level security (unguessable ids, website images only); `sandbox` CSP |
| `/site/[uni]/robots.txt`, `/site/[uni]/sitemap.xml` | GET | Public | Published pages only |
| `/verify/fonts/[file]` | GET | Public | Fixed font allowlist |

Server actions go through the same service functions as the pages. Each one rebuilds its actor through `spaceContext` or `platformContext`, so the rules in the table apply to them too.

## Recommendations

1. **Keep the database off the public internet.**
   - On Supabase, turn the Data API off, or remove `public` from its exposed schemas. The policy script now revokes the grants, but turning the API off removes the route completely.
   - On Neon, give the app only the `zinny_app` connection string. Use IP allow-listing if the plan offers it.
2. **Give the owner role BYPASSRLS explicitly.** Row-level security is forced now, so the role in `DATABASE_URL_OWNER` needs SUPERUSER or BYPASSRLS. Neon and Supabase owner roles normally have BYPASSRLS. If one doesn't, the deploy stops with the exact `ALTER ROLE` to run, and the previous deployment keeps serving.
3. **Set every secret in production:** `STORAGE_SIGNING_SECRET` (or use the S3 driver), `AUTH_SECRET`, `KYC_ENCRYPTION_KEY`, `CRON_SECRET`. Fix DATA-09 and DATA-12 so the app refuses to start without them, as the KYC key already does outside demo mode.
4. **Ask for consent before attaching an existing identity to an institute** (DATA-10). Until the invited person accepts, the institute should see only what it typed.
5. **Add a runtime check that the app connection is bound by row-level security** (DATA-14). This is a one-line query, cached once per process, in core's `withTenant`.
6. **Treat the data console as break-glass.**
   - Consider a second-person approval, or a time-boxed unlock with a reason, before writes.
   - Alert on `plat.data.*` entries.
   - Keep the audit log in an append-only store outside the database for long-term evidence.
7. **Shorten lesson video links, or tie them to the session,** if paid recordings need protection beyond the current window of up to 6 hours (DATA-13).
8. **Block `@zinny.demo` and `@demo.edu` sign-ins in production unless `ZINNY_DEMO=1`.** This catches a demo database restored into production; DATA-08 only blocks seeding. Owner: auth.

### Operational notes for this change

- `src/db/policies.sql` now fails loudly if the roles are wrong. This runs on `npm run db:push`, on `db:migrate` and in the Vercel prebuild.
- A reporting or BI role now has to be granted in `policies.sql` on purpose. Any other grant is revoked on the next push.
- `tests/core/rls-coverage.test.ts` expected table-wide UPDATE on `users` and `universities`. It now checks the column grants instead.
- No new environment variables. `STORAGE_SIGNING_SECRET` was already supported, and is now required in production when local storage is used.
