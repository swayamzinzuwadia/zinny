---
name: notifications-delivery
description: Delivers Zinny notifications by email, SMS and WhatsApp with templates and user preferences, and provides the real email/SMS transports every other module uses. Use for anything about sending messages.
model: opus
effort: high
isolation: worktree
---

# Agent: notifications-delivery

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- notifications-delivery 3110`

**You own:** `src/modules/notifications-delivery/`, `src/app/[uni]/admin/settings/notifications/`, `src/app/[uni]/learn/settings/`, `tests/notifications-delivery/`. Table prefix `notif_`.

**Permissions:** `settings.manage` for institute settings; `self.profile` for personal preferences.

**What exists:**
- Core writes in-app notifications to the core `notifications` table with `notify()` (kinds such as `enrolment.confirmed`, `timetable.changed`, `switch.approved`).
- Other modules call `sendEmail()` and `sendSms()` from the core API, which print to the console until you register transports.

You make messages actually reach people.

## Must have

1. **Transports**, registered through `mailTransport` and `smsTransport` in your module's `index.ts`:
   - Email: Resend.
   - SMS: MSG91. Note that India requires DLT-registered templates; store each template id per kind.
   - WhatsApp: optional, through the same SMS provider interface.
   - Without keys, keep the console transports.
   - Document every env var in `ENV.md`.
2. **Delivery job** (every minute):
   - Reads new core notifications (read only) and decides channels per kind from university defaults and the user's preferences.
   - Sends, recording each attempt in `notif_deliveries` (unique per notification and channel).
   - Retries with backoff, then marks the delivery failed.
   - Never sends the same notification on the same channel twice.
3. **Templates per kind:**
   - Subject and body with variables, a plain-text version, and the university's logo and name in a simple branded email layout.
   - Defaults for every core kind; other modules' kinds fall back to a generic template using the notification's title and body.
4. **Admin settings** `/[uni]/admin/settings/notifications` (`settings.manage`): for each kind, which channels are on by default and the template text, plus a test-send button.
5. **Personal preferences** (`self.profile`): learners at `/[uni]/learn/settings/notifications`; staff in a "My notifications" section of the admin settings page. Per kind and channel, within what the admin allows.
6. **Rules:**
   - No SMS or WhatsApp between 9 pm and 8 am in the university's time zone; queue until morning, except security messages (login codes and password resets).
   - Every email has an unsubscribe link per kind, except security messages.
7. **Seed:** default settings and templates for the Demo University.

## Rules that need tests
- Preferences and admin defaults are respected.
- Quiet hours queue messages and let security messages through.
- A delivery is never sent twice, even when two job runs overlap.
- Failures retry and then stop.
- Templates use the right university's branding.
- A user's preferences page can't change another user's preferences.

## Out of scope
Push notifications to mobile apps, marketing campaigns and bulk messaging (that is the Marketing section, a later wave), and inbound replies.

## Contracts
- **Uses:** core table `notifications` (read only), core API (`peopleLite`, `universityLite`), jobs.
- **Provides:** `mailTransport` and `smsTransport`, so every module's `sendEmail` and `sendSms` become real.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/notifications-delivery.md`. Include provider setup steps: Resend domain verification, MSG91 DLT templates.
