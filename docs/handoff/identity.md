# identity handoff

Branch `agent/identity`, from `foundation-v1`. Screenshots are in `docs/handoff/identity/` (desktop; sign-in, reset, invite and learner profile screens also at 390 px; invitations page also at 820 px tablet).

## Built

**Invitations**
- Handler `identity.send-invite` on `user.invited`. It creates a single-use link, valid 7 days, and emails it through `sendEmail` (`kind: "identity.invite"`).
  - It is idempotent per event (unique `event_id`) and skips people who already have a password.
  - A Zinny team invite (`universityId: null`) gets a team link that leads to `/platform`.
- University tokens look like `<university id>.<secret>`. Only the SHA-256 of the whole token is stored, and the lookup runs under that university's row-level security. Changing the university part can only make a link invalid.
- `/invite/[token]` shows the institute, the role and the email, and sets the password. Joining signs the person in and takes them straight to the admin panel or the learner app.
  - Clear states for expired, revoked, replaced (a newer one was sent), already used, already has a password, role removed, and invalid.
  - The page sends no referrer, so the token never leaks to other sites.
- `/[uni]/admin/users/invites`:
  - Lists who is waiting, whose link expired, people with a role but no password who were never sent one, and who joined in the last 30 days.
  - Resend sends a new link and the old one stops working. Resends are at most once a minute per person.
  - Revoke stops the link but keeps the role.
  - Access is scoped like core's role rules: an Institute Admin sees everyone; a HOD sees faculty in their own department.
  - A "Sign-in options" card (`settings.manage`) turns phone sign-in on or off.

**Password reset**
- `/reset` always gives the same answer. The lookup, the token and the email all happen after the response (`after()`), so timing gives nothing away either; a test compares medians.
- Emails are capped at 3 an hour per address (silently) and 20 an hour per network.
- The link is single-use and valid for 30 minutes. Saving a new password:
  - cancels the person's other reset links;
  - ends every session, then signs this browser in;
  - lifts a lockout;
  - sends a "your password was changed" email;
  - is written to the audit log of every university the person belongs to.

**Phone sign-in**
- A "Mobile number" tab on `/login`, shown when the institute has turned it on. The institute comes from `?uni=`, then from `next`, then from a remembered cookie.
- The 6-digit code goes through `sendSms` (`kind: "security.otp"`). It lasts 5 minutes and allows 5 tries. Resend is available after 30 seconds, up to 5 codes per sign-in and 5 per number per hour.
- 10 wrong codes in an hour pause the number for 30 minutes.
- Unknown numbers look identical on screen, but no SMS is sent.
- A shared family phone asks which account is signing in.
- Codes are stored as an HMAC. The browser holds an httpOnly reference cookie.

**Sign-in protection**
- 5 wrong passwords for an email pause it for 15 minutes, and the right password is refused too. Repeat locks within a day double, up to 4 hours. The rule applies whether or not the account exists. The screen shows "N tries left" warnings and a lock state with a reset link.
- 50 failures from one network in 15 minutes pause that network.
- Unknown emails cost one bcrypt comparison too, so they take as long as a wrong password.
- Every sign-in creates a new session id and ends the browser's previous session.
- Sliding expiry: 14 days without use, 30 days at most. The expiry is extended at most every 10 minutes.
- Cookies are httpOnly and SameSite=Lax; in production they are also `Secure` and use the `__Host-` prefix.
- bcrypt cost is 12 in production. Older hashes are upgraded at sign-in.
- Demo accounts appear only outside production or with `ZINNY_DEMO=1`, as before. Only the listed demo emails work now: before, any email could be posted.
- `next` redirects stay on this site. `//host` and `/\host` are refused.

**Profile** at `/[uni]/profile` (`self.profile`, for any university role)
- Name.
- Mobile number: saved only after a code sent to the new number is entered.
- Photo through `storage()`. It is shrunk in the browser, then checked, rotated, cropped to 512 px and saved as WebP on the server, which drops location data.
- Change password: needs the current one, pauses after 5 wrong tries, and signs out other devices.
- Sessions list (device, how the person signed in, when, last active, IP), with "Sign out" for each device and "Sign out everywhere".
- It has its own small header with links back to the admin panel and/or the learner app.

**Seed**
- Phone sign-in is on, with mobile numbers for the demo accounts. Riya and her mother share one.
- Three people who haven't joined yet: Neel (waiting), Neil (waiting) and Diya (link expired). Farah and Riya have already joined.
- Earlier sessions on other devices for Asha and Riya.
- A generated photo for Asha.
- The seed prints working invitation links.

**Housekeeping job** `identity.housekeeping` (daily): old phone codes, ended sessions, stale rate limits, expired tokens.

## Not built (and why)
- Single sign-on, two-factor authentication for staff, and parent self-registration are out of scope. Staff two-factor authentication is the natural next step. It would add a second check after the password in `signInWithPassword`, before `startSession`.
- Links to the profile and invitations pages from the admin sidebar and the learner menu. Those files belong to core (see requests).
- Showing profile photos in core's avatars. Those components belong to core (see requests).

## Contracts used / provided
- **Handles:** `user.invited`, both university and Zinny team invites. **Emits:** nothing.
- **Slots:** none. **Job:** `identity.housekeeping` (daily).
- **Core API:** `withTenant`, `audit`, `systemActorFor`, `assertCan`, `can`, `reach`, `universityLite`, `sendEmail`, `sendSms`, `storage`.
- **Core tables, read:** `users`, `role_assignments`, `universities`, `sessions`.
- **Core tables, written** (brief exception, from `src/server/auth/` and `src/modules/identity/auth.ts` only): `users.password_hash`, `users.name`, `users.phone`, and `sessions`.
- **New tables:**
  - University tables (row-level security): `idn_invites`, `idn_settings`, `idn_otp_challenges`, `idn_photos`.
  - Global tables (closed to the app role; tested): `idn_tokens`, `idn_sessions`, `idn_throttles`.
- `src/server/auth/session.ts` keeps the exports core uses: `currentUserId`, `signOut`, `spacesFor`, `startSession`, `hashPassword`. It also adds `currentSession`. `signIn` was removed; only the login page used it.

## New packages
- `sharp@^0.35.5`, for profile photos. It was already installed as Next's optional dependency; now it's declared.

## New environment variables
`APP_URL` and `AUTH_SECRET` (both needed in production). Details, cookies and proxy notes are in `src/modules/identity/ENV.md`.

## Requests for other owners
1. **Core, admin layout and learner layout:** a "Your profile" link to `/[uni]/profile`, in the admin sidebar's user card and in the learner avatar menu.
2. **Core, `src/server/authz/menu.ts`:** an "Invitations" item under Users (`/users/invites`) for Institute Admins and HODs.
3. **Core, `Avatar`:** show the profile photo. Identity can provide `photoUrls(actor, userIds)` from `src/modules/identity/profile.ts` through a contract, if core wants it.
4. **Core, schema:** an index on `sessions(user_id)`. The sessions list filters on it.
5. **Core, routes:** `src/app/[uni]/page.tsx` redirecting to `/[uni]/admin` or `/[uni]/learn`. `spaceContext` sends signed-out people to `/login?next=/<slug>`, and that page doesn't exist. Identity works around this by resolving bare slugs at sign-in.
6. **Core seed:** a few demo people without passwords. Identity's seed currently clears the passwords of neel, neil and diya @demo.edu so the invitations page has real data. The integrator may prefer core to create them that way.
7. **notifications-delivery:** templates or DLT ids for `identity.invite`, `security.reset`, `security.password_changed` and `security.otp`. SMS and email go through `sendSms` and `sendEmail` with these `kind`s.
8. **zinny-team-panel:** Zinny team invites are stored in `idn_tokens` (`purpose = 'team_invite'`). A resend button there would need an identity function; ask if wanted.

## Known issues
- In development, Next recompiles any page that was idle for a minute. On this loaded machine that took up to 50 seconds, and a request made mid-compile can fail once with a Next internal error. This is dev only; the click-through passed when routes were warm.
- Under `npm start` on plain http, the `__Host-` session cookie relies on the browser treating `localhost` as secure, which Chromium does. Production must be served over HTTPS.
- Per-network limits trust `X-Forwarded-For` (see ENV.md).
- Revoking an invitation doesn't stop the person setting a password through "Forgot password", because their role still gives them access. The page says so: remove the role to take away access.
- A person who belongs to several institutes has one photo per institute, because storage keys are per university.
