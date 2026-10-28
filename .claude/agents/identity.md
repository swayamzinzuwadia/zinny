---
name: identity
description: Builds Zinny sign-in and account security — invitations, password set and reset, phone OTP login, login protection, sessions and the profile page. Use for anything about accounts and signing in.
model: opus
effort: high
isolation: worktree
---

# Agent: identity

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- identity 3111`

**You own:** `src/modules/identity/`, `src/server/auth/`, `src/app/login/`, `src/app/invite/`, `src/app/reset/`, `src/app/[uni]/profile/`, `src/app/[uni]/admin/users/invites/`, `tests/identity/`. Table prefix `idn_`.

**Permissions:** `self.profile` for the profile page; `user.manage_roles` for the invites page.

**Allowed exceptions:** sign-in, invites and resets happen before anyone is inside a university, so code in `src/server/auth/` and your module's auth service may use `systemDb()`. It may write only `users.password_hash`, `users.name`, `users.phone` and the core `sessions` table. Nothing else.

**What exists:** email and password sign-in with session cookies (`src/server/auth/session.ts`), a space picker at `/`, demo one-click accounts in development, and people created by admins, CSV import or the Zinny team without passwords. Core emits `user.invited` for each of them.

## Must have

1. **Invitations:**
   - Handle `user.invited`: create a single-use token (stored hashed, valid 7 days) and send an email through `sendEmail` with a link to `/invite/[token]`.
   - That page shows the institute name and lets the person set a password, then signs them in.
   - `/[uni]/admin/users/invites` (`user.manage_roles`): pending invites with resend and revoke.
2. **Password reset:**
   - `/reset` asks for an email and always gives the same answer, whether or not the account exists.
   - The emailed link is single-use and valid 30 minutes.
   - Setting a new password signs out all other sessions.
3. **Phone OTP sign-in:**
   - A second tab on `/login`, turned on per university.
   - 6-digit code through `sendSms`, valid 5 minutes, 5 attempts, resend after 30 seconds.
4. **Sign-in protection:**
   - Rate limits per email and per IP. A temporary lock after repeated failures, with a generic message.
   - A new session id on every sign-in, sliding expiry, and secure cookie flags.
   - Demo accounts only when `NODE_ENV` isn't production or `ZINNY_DEMO=1`, as now.
5. **Profile** `/[uni]/profile` (`self.profile`), used from both the admin panel and the learner app:
   - Name, phone and photo (through `storage()`).
   - Change password, with the current one required.
   - Active sessions with "Sign out" per session and "Sign out everywhere".
6. **Login page polish:** keep the current brand design, add clear states for locked account, expired link and wrong code, and work at 390 px.

## Rules that need tests
- Tokens are single-use, expire on time and are stored hashed.
- Reset responses are identical for known and unknown emails, including timing within reason.
- OTP attempts are capped.
- Lockout triggers and clears.
- Revoking a session signs that device out.
- An invite for university A can't be used to reach university B.
- Nobody can change another person's profile.

## Out of scope
SSO (Google Workspace or Microsoft), two-factor authentication for staff (note it as a next step), and parent self-registration.

## Contracts
- **Uses:** event `user.invited`; core API (`sendEmail`, `sendSms`, `storage`, `universityLite`, `peopleLite`); the core `users` and `sessions` tables under the exception above.
- **Provides:** working invite, reset and OTP flows, the profile page, and the invites admin page.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/identity.md`.
