# gamification handoff

User Leaderboards (PRD pages 3, 4 and 8; phase 2): XP rules, awarding, badges, challenges and leaderboards, driven only by events. Port 3108.

## Built

**XP rules** (`/[uni]/admin/leaderboards/xp-rules`, `rules.ts`)
- A rule is a trigger, points (1–1000) and an optional daily cap (1–100 awards per student per day). The triggers are:
  - finishing a lesson
  - passing a test, scoring at least N% on a test, or submitting a test
  - a live class marked present, or present or late
  - submitting an assignment, or submitting it on time
  - scoring at least N% on an assignment
  - completing a course
- Scope is the whole university or one department. University-wide rules need `leaderboard.manage` for the whole university, so a HOD can't create, edit, turn off or backfill them. A HOD manages their own department's rules only.
- Rules are edited or turned off, never deleted, so the ledger always says why XP was given.
- "Apply to past activity" replays this university's matching `domain_events` (read only, keyset-paged, each event in a savepoint) through the same path as live delivery. It is safe to run twice.

**Awarding** (`engine.ts`, handler `gamification.award-xp`)
- Each event is normalised into `gam_activity`, once per (event, student).
- Each matching active rule writes to `gam_xp_ledger`, then emits `xp.awarded`. Ledger uniqueness:
  - on (source event, rule, user), as the brief asks;
  - and on (rule, user, thing earned), so a re-taken test, a re-completed lesson or a re-marked class never pays twice.
- Daily caps are counted on the day the activity counts for: the class date for attendance, otherwise the event's date in the university's time zone. A per-(rule, user, day) advisory lock keeps the cap correct when two drains run at once (tested).
- A department rule only counts activity in that department's courses. An event with no course or batch belongs to no department.
- XP is attributed to the student's current batch in the course. `enrolment.switched` (handler `gamification.follow-switch`) moves it to the new batch.
- Malformed payloads and people outside the university are ignored, never retried.

**Badges** (`/badges`, `badges.ts`)
- What a badge can count: XP, lessons, tests passed, classes attended, attendance streak in weeks, assignments on time, courses completed. A badge can be university-wide or for one department.
- 12 built-in SVG icons in brand tokens. Locked badges are drawn in outline; a gold ring marks one earned in the last 7 days.
- A badge is awarded once (unique per badge and student), with an in-app notification. Creating a badge, turning it back on or lowering its target awards students who already qualify.
- Counting rules:
  - each lesson, test or assignment counts once;
  - a class counts by its latest mark;
  - a streak week needs every marked class attended (present or late) and at least one class marked.

**Challenges** (`/challenges`, `/challenges/[id]`, `challenges.ts`)
- A challenge has a title, start and end dates, a metric and a target, for one batch or a whole course.
- Progress is live for every student. Finishers are listed in the order they reached the target.
- The hourly job `gamification.close-challenges` freezes the winners once a challenge has ended and notifies each winner once. Later activity doesn't change the result.
- A challenge can be cancelled until it ends.

**Leaderboards** (`/[uni]/admin/leaderboards`, `leaderboards.ts`)
- By batch or by course, for this week (Monday start), this month or all time. Everyone currently in the batch is listed, including students with 0 XP.
- Ties share a rank and the next rank skips (1, 2, 2, 4).
- An admin chooses how student names show to students: full name, or first name and initial (the default). Staff always see full names.

**Staff access**
- Admin: everything.
- HOD: university-wide rules and badges read only, plus their own department's rules, badges, challenges and boards.
- Permanent faculty: view only, for their batches and their courses.
- Students: no staff pages.

**Learner side**
- `/[uni]/learn/leaderboard`: XP total, this week and this month; rank in each batch, with a period switch; challenges with my progress; the badge shelf with progress; recent XP. Built mobile first and checked at 390 px.
- Slots:
  - `learnerHomeCards.xp`: my XP and best rank, plus the running challenge or the next badge.
  - `learnerHubSections.xp`: XP, a rank per course, and earned badges.
  - `learnerCourseTabs.leaderboard`: "My batch" or "Whole course" across the three periods, my row marked, and that batch's challenges.
  - `dashboardCards.top-learners`: the top 5 this month within the viewer's reach.

**Seed**
- 7 university-wide rules (and 1 turned off), plus one department rule each from Hema (CS) and Mehul (MKT).
- 6 badges, one of them for Marketing only.
- About 500 learning events for the running batches, emitted as other modules would emit them. A type is only emitted when no other module's seed has produced it yet.
- Every rule is then applied to past events, giving about 7,900 XP to 12 students and about 30 badges.
- 4 challenges: running for a batch, running for a course, upcoming, and ended with frozen winners.

**Tests:** 83 in `tests/gamification/` (9 files).

## Not built (and why)
- XP isn't taken back when attendance is corrected from present to absent, because the ledger is append-only. Badges and challenges already use the latest mark.
- No manual XP adjustments, rewards with money value, cross-university boards or push notifications for streaks: out of scope in the brief.
- No report in the Reports page. Not required for gamification (PRD page 8 lists the required reports).

## Contracts used / provided
- **Handles:** `lesson.completed`, `test.submitted`, `attendance.marked`, `assignment.submitted`, `assignment.graded`, `enrolment.completed` (`gamification.award-xp`); `enrolment.switched` (`gamification.follow-switch`).
- **Emits:** `xp.awarded` `{ userId, points, reason, sourceEventId }`, once per ledger row.
- **Slots:** `learnerCourseTabs.leaderboard` (600), `learnerHubSections.xp` (600), `learnerHomeCards.xp` (600), all `self.view_xp`; `dashboardCards.top-learners` (600, `leaderboard.view`).
- **Job:** `gamification.close-challenges` (hourly).
- **Core API:**
  - context: `withTenant`, `audit`, `emit`, `assertCan`, `can`, `reach`, `systemActorFor`, `universityLite`, `todayFor`
  - people and enrolments: `peopleLite`, `batchLite`, `getCourseLite`, `batchStudentIds`, `studentEnrolments`
  - messages: `notify`
  - seed only: `scheduledBatches`, `expandSessions`
- **Core tables read:**
  - `domain_events`, for backfill, and in the seed to avoid doubling another module's demo events;
  - `departments`, `courses` and `batches`, for names and scope.

## New packages
None.

## New environment variables
None (see `src/modules/gamification/ENV.md`). The hourly job needs core's existing `/api/jobs/run?every=hour` cron.

## Requests for other owners
- **Core (learner nav):** add "Leaderboard" (`/[uni]/learn/leaderboard`) to `src/app/[uni]/learn/nav.tsx`. Today the page is reached from the home card, the My learning section and each course hub tab.
- **Core (admin placeholders):** remove the four `leaderboards*` entries from `PLANNED` in `src/app/[uni]/admin/[...rest]/page.tsx`. My routes already take precedence, so this is tidiness only.
- **Integrator (seed order):** `live-classes` seeds after `gamification` alphabetically. Gamification therefore emits its own demo `attendance.marked` events (present, late and a few absences for the running batches), and live-classes' real ones will add to them. Drop either set if the demo should show only one.
- **notifications-delivery:** badge and challenge notifications use the kinds `gamification.badge` and `gamification.challenge_won`, if you want templates for them.

## Known issues
- Lessons, tests and assignments in the demo all happen "today", because `emit` stamps the current time. So "this week" and "all time" differ only by attendance, which uses the class date. The daily lesson cap (10) visibly trims the keenest students' XP.
