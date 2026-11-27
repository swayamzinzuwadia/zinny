# Zinny security review: sign-in, accounts and privilege escalation

Scope: student and institute sign-up, invitations, joining codes, role grants (institute, custom and Zinny team roles), sessions, "sign in as", support mode, view-as, demo accounts, passwords, reset links, phone codes, permission checks on server actions and pages, and frozen or suspended institutes. Reviewed at commit `b2d71f6`; fixes are on this branch.

## Summary

Zinny's sign-in and permission core is well built: sessions, passwords, reset links, invitations and role editing all held up under attack. The one serious gap was phone sign-in. A mobile number can be typed in by an institute's admin, and a phone code signed the browser in to the whole account, so the admin of a self-signed-up institute could pre-create an account for someone not yet on Zinny and keep a session that later carried that person's Zinny team or other-institute roles. That is fixed: a phone-code session now works only inside the institute where the code was entered. Seven more issues were fixed or mitigated, and the remaining open items belong to other owners or are design choices.

| Severity | Found | Fixed or mitigated | Open |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 4 | 3 | 1 |
| Low | 5 | 3 | 2 |
| Info | 3 | 0 | 3 |

## Findings

| ID | Severity | Title | Where | What an attacker could do | Status | Proof |
|---|---|---|---|---|---|---|
| AUTH-01 | High | A phone code signed in to the whole account, though an admin can type in the number | `src/modules/identity/auth.ts:711` (phone sign-in matches `users.phone`); `src/server/services/users.ts:268` (admins set the phone of a new account); `src/server/auth/session.ts` | Anyone can sign up an institute and turn on phone sign-in. Its admin adds a person with the email of someone who isn't on Zinny yet (a future Zinny team member, or a teacher another institute is about to add) and the admin's own mobile number, then signs in to that account with a code. When the real person later joins the Zinny team or another institute, the account is reused and the attacker's session carries those roles: the Zinny panel as Super Admin, or another institute's admin panel. | **Fixed.** A phone-code session records the institute the code was entered at (`idn_sessions.scope_university_id`). Elsewhere it holds no roles (`src/server/actor.ts:53`, `:110`), counts as signed out (`src/server/auth/session.ts:363`, `src/server/context.ts:88`) and can't start "sign in as" (`src/server/auth/impersonation.ts:112`). Inside its institute it drops Zinny team roles, so no support mode either. A phone session that doesn't know its institute (made before the fix) is bound to none and opens nothing (`session.ts:169`). | `tests/security/auth-phone-session.test.ts`, `tests/security/auth-phone-context.test.ts` |
| AUTH-02 | High (only with `ZINNY_DEMO=1` on a production build) | One-click demo sign-in included the Zinny Super Admin | `src/modules/identity/auth.ts:301`, `:321`; `src/server/auth/config.ts:69` | With `ZINNY_DEMO=1` on a production build that has the demo data (the preview guide sets both), anyone could click "Zara, Super Admin" and get a passwordless Super Admin session: every institute, "sign in as" anyone, team roles. | **Mitigated.** A production build never signs in to a Zinny team demo account, or any demo account holding a Zinny team role, in one click, and doesn't show those buttons. Institute demo accounts still work in one click on demo deployments, by design. Development is unchanged. A private demo deployment can opt back in with a second switch, `ZINNY_DEMO_TEAM=1` (added 27 Nov 2026 at the owner's request; off by default, documented with its risk in `src/modules/identity/ENV.md`). | `tests/security/auth-demo.test.ts` |
| AUTH-03 | Medium | Rate limits trusted the caller's own `X-Forwarded-For` | `src/server/auth/session.ts:78` | Production runs on AWS, where the load balancer appends to the header the caller sent. Taking its first entry let a caller pick any address per request: unlimited password guessing across accounts and unlimited sign-ups, codes and reset emails per network, or locking a college's shared address out of sign-in by sending its address with wrong passwords. | **Fixed.** The address `TRUSTED_PROXY_HOPS` entries from the right is used (default 1, right for Vercel and one AWS load balancer; documented in `src/modules/identity/ENV.md`). | `tests/security/auth-client-ip.test.ts` |
| AUTH-04 | Medium | "Sign in as" could leave a lasting way back in | `src/modules/identity/profile.ts:184`, `:236` and the other credential functions | A Super Admin signed in as someone for two hours could change that person's mobile number to their own, confirm it with the code, and keep signing in as them with phone codes after the two hours, unnoticed. They could also change the password (with the current one) or sign the person out everywhere. | **Fixed.** While signed in as someone, the mobile number, password and devices can't be changed. Name and photo still can, for support. | `tests/security/auth-impersonation.test.ts` |
| AUTH-05 | Medium | Support mode could be made permanent | `src/server/services/users.ts:147` | Support mode makes a Support Agent Institute Admin of one institute for two hours. From inside it they could give themselves Institute Admin (by id, by email, by CSV, or as a teacher) and keep it after the session ended. | **Fixed.** In support mode you can't give yourself a role. Adding and fixing other people's roles still works. | `tests/security/auth-support-mode.test.ts` |
| AUTH-06 | Low | Phone-code key fell back to a constant in the source code | `src/server/auth/tokens.ts:25` | With `AUTH_SECRET` and `CRON_SECRET` unset in production, phone codes were stored under a public key; with a copy of the database, any live code could be worked out in moments. | **Fixed.** A production build refuses to send or check codes without a secret; only development uses the constant. | `tests/security/auth-secrets.test.ts` |
| AUTH-07 | Low | Team actions taken while signed in as a team member didn't name the real Super Admin | `src/server/tenant.ts:67`; `src/server/services/core-api.ts:266` and the other team-panel writes; `src/server/services/support.ts:41` | A Super Admin signed in as another Super Admin could grant or remove team roles, enter support mode, or change an institute's details or trial, and the log showed only the other person. | **Fixed.** These entries now carry `impersonatedBy`, like every institute audit entry already did. | `tests/security/auth-impersonation.test.ts` |
| AUTH-08 | Low | Joining codes could be guessed without limit | `src/modules/identity/joining.ts:82`, `src/server/auth/config.ts:59` | A code is 6 characters. `/join`, and sign-up with a code (checked before the sign-up limit), accepted unlimited guesses, so a script could find institutes that admit students straight away ("instant" mode). | **Fixed.** 10 codes that match nothing per hour, per person and per network, then a one-hour pause. | `tests/security/auth-join-codes.test.ts` |
| AUTH-09 | Medium | The app's database role can change any column of `users` for anyone in the institute | `src/db/policies.sql:97-108` | Not exploitable through today's code (the profile service writes only your own name and phone). But accounts are shared across institutes, and the policy lets any query running for institute A change the email or password hash of anyone with a role at A, including that person's access at other institutes and the Zinny team. One bug in any module would be a cross-institute account takeover. | **Open:** owned by the database agent. Grant `update (name, phone)` only, or add a trigger refusing `email` and `password_hash` changes from `zinny_app`. | None (no change in this area) |
| AUTH-10 | Low | Erasure by the retention job leaves the person signed in | `src/modules/privacy/services/retention.ts:103`, `:153` | The admin actions end an erased person's sessions (`src/app/[uni]/admin/settings/privacy/actions.ts:18`), but the automatic retention job doesn't, so an erased account's open sessions keep working until they expire. | **Open:** owned by the privacy module. Call `revokeAllSessions(userId)` when `eraseInInstitute` anonymises. | None |
| AUTH-11 | Low | An admin can attach any existing account to their institute | `src/server/services/users.ts:268` (`zinny_upsert_user` reuses the account), `users.ts:238` (`assignRole` takes any user id) | Any institute admin, including one who signed up a minute ago, can add an existing person by email and then see their name, email and mobile number. After AUTH-01 this gives them no access to the account. | **Open:** a product decision (shared identities). Consider asking the person to accept before an existing account is added. | None |
| AUTH-12 | Info | A Super Admin can "sign in as" another Super Admin | `src/server/auth/impersonation.ts:114` | Lets one Super Admin act as another; the team panel's own tests expect this. With AUTH-07 the log now names both. | **Open, by design.** Recommend refusing "sign in as" for any account with a Zinny team role. | Existing `tests/zinny-team-panel/accounts.test.ts` |
| AUTH-13 | Info | Anyone can pause password sign-in for any email | `src/server/auth/config.ts:38` | Five wrong passwords pause sign-in with that email for 15 minutes, doubling up to 4 hours. | **Accepted.** The reset link clears the pause at once; phone sign-in still works. | Existing `tests/identity/signin.test.ts` |
| AUTH-14 | Info | Some app paths aren't reserved as institute addresses | `src/modules/zinny-team-panel/services/universities.ts:25` | A self sign-up can take `privacy`, `frozen`, `suspended` or `book-a-demo`, whose app pages take priority, so that institute's own pages can't be reached. No access to anything else. | **Open:** owned by the team panel. Add them to `RESERVED_SLUGS`. | None |

### Notes on AUTH-01

- What changes for people: someone who signed in with a phone code at one institute and also belongs to another (or to the Zinny team) signs in with their password to open the other place. Phone sessions made before this change open nothing, so those people sign in once more.
- What stays: inside its own institute, a phone session can still see the account's profile and its list of devices. A phone number typed in by a hostile admin can therefore still show that admin where else the person signs in, and sign the person out of everywhere. Recommended next step (identity): limit the sessions list and "Sign out everywhere" to sessions of the same institute while signed in with a phone code.
- Schema: one nullable column, `idn_sessions.scope_university_id`, applied with `npm run db:push`. It is deliberately not named `university_id`, so the table stays off the app role.

## Controls verified

Sign-up can't create admins

- Student sign-up always makes a plain student of the institute in the address, whatever extra fields are posted: the action reads only name, email, password, phone, `uni`, `code` and `departmentId` (`src/app/login/actions.ts:104`), and joining gives only the student role (`src/modules/identity/joining.ts:136`). Proved with a forged form in `tests/security/auth-signup.test.ts`.
- A posted department from another institute is dropped, not attached (`src/modules/identity/joining.ts:119`).
- Sign-up with an email that already has an account is refused, so nobody signs up on top of an admin or a pending invitation (`src/modules/identity/auth.ts:142`, unique index on `lower(email)`).
- Institute self sign-up makes the creator Institute Admin of the new institute only (`src/server/services/core-api.ts:360`), refuses an existing email (`core-api.ts:354`) or address, and fixes the trial length on the server (`src/modules/onboarding/services/signup.ts:165`); GST must match the chosen state. Extra keys asking for a Zinny role, another institute, a status or a 10-year trial are ignored (`tests/security/auth-signup.test.ts`).
- Phone sign-up confirms the number with a code before saving it (`src/modules/identity/profile.ts`, `verifyPhoneChange`).

Role grants

- Institute roles can only be given at institute scopes; Zinny team and marketplace roles are refused there (`src/server/services/users.ts:155`), including in CSV imports.
- A HOD can give only faculty roles, only in their own department, batch roles included (`users.ts:180`).
- Custom roles never gain `role.manage` or `user.manage_roles`, and saved permissions are filtered again on every read (`src/server/authz/abilities.ts:227-233`). Only a Super Admin can change the Institute Admin role (`src/server/services/roles.ts:237`) or team roles (`roles.ts:45`).
- Team roles: grant and remove are Super Admin only (`core-api.ts:235`, `:280`), checked again in the team service; nobody can remove their own Super Admin role (`core-api.ts:285`), and an admin can't remove their own Institute Admin role (`users.ts:258`).
- Invitation links: 256-bit secret, only the hash stored, the institute part covered by the hash, single use, 7 days, refused once the person has a password or no longer has a role (`src/modules/identity/auth.ts:587-610`). Invitation and reset emails are never stored by the delivery log (security kinds).

Sessions

- Cookie: `__Host-` prefix, httpOnly, Secure, SameSite=Lax, path `/` in production (`src/server/auth/session.ts:43`, `:58`); 256-bit random token, only its SHA-256 stored (`src/server/auth/tokens.ts:9`).
- New session id on every sign-in, ending the browser's previous one (`session.ts:310`); 14 days idle, 30 days at most.
- Password change ends every other session and rotates the current one (`src/modules/identity/profile.ts:387`); a reset ends them all (`auth.ts:411`); sign-out deletes the row.
- "Sign in as": Super Admin only, checked against the database on start and on every request; two hours, never extended; logged in the platform log and each of the person's institutes; the way back is a separate SameSite=Strict cookie that only ever restores the Super Admin's own session (`src/server/auth/session.ts:176`, `src/server/auth/impersonation.ts:31`, `:134`).
- View-as: the cookie grants nothing by itself; the Super Admin role is checked on every request and every write is refused or rolled back (`src/server/context.ts:74`, `:93`, `src/server/tenant.ts`).
- Support mode: needs `platform.support_mode`, a written reason, lasts two hours, ends when the role does, and every change carries the support session id (`src/server/services/support.ts:10`, `src/server/actor.ts:127`).
- Demo accounts are off on a production build unless `ZINNY_DEMO=1`, and only the listed emails work (`src/server/auth/config.ts:69`).

Passwords, reset and codes

- bcrypt cost 12 in production, older hashes upgraded at sign-in (`src/server/auth/passwords.ts:12`); 8 to 72 bytes, common and personal passwords refused.
- Reset links: 256-bit, hash only, 30 minutes, single use, every other link cancelled (`auth.ts:406`).
- No account enumeration: same message and same bcrypt work for unknown emails (`auth.ts:242`); reset requests do their work after the response; phone challenges are made whether or not the number belongs to anyone.
- Codes: 6 digits, HMAC-stored, 5 tries each, 5 sends per sign-in, 10 wrong codes per number per hour then a 30-minute lock (`src/server/auth/config.ts:42`); 5 wrong passwords per email per 15 minutes then a doubling lock (`config.ts:38`).

Permission coverage and institute status

- Every `/platform` page and route handler reaches a service that calls `assertPlatform` or `assertSuperAdmin` (spot-checked search, institutes, signup documents, support log export, invoice PDF); the layout's redirect is not relied on.
- Server actions take the institute from the address and build the actor from the session (`spaceContext`), never from a posted `universityId`, `userId` or role; Zinny panel actions that take a `universityId` are platform-permission checked.
- Suspended institutes send everyone but the Zinny team to the paused page (`src/server/context.ts:99`); existing `tests/core/suspended.test.ts`.
- Frozen institutes: only admins with `settings.manage` reach choose-plan pages. A server action posted to the choose-plan address is forwarded by Next.js to a page that actually uses it (`node_modules/next/dist/server/app-render/manifests-singleton.js:337`), so the route check can't be sidestepped. Plan test payments need the mock gateway and development or `ZINNY_DEMO=1`.

## Recommendations not done here

1. Database: restrict `zinny_app` to updating `users.name` and `users.phone` (AUTH-09).
2. Privacy: end sessions when the retention job anonymises someone (AUTH-10).
3. Identity: while signed in with a phone code, show and end only that institute's sessions (AUTH-01 notes).
4. Team panel: refuse "sign in as" for accounts with a Zinny team role (AUTH-12), and reserve `privacy`, `frozen`, `suspended` and `book-a-demo` (AUTH-14).
5. Product: ask an existing person to accept before an institute attaches their account (AUTH-11).
6. Operations: never run `db:seed` on a database with real data (it creates `zara@zinny.demo` with the public password `zinny123`), and set `AUTH_SECRET` and `TRUSTED_PROXY_HOPS` on every production deployment.
