---
name: gamification
description: Builds Zinny's User Leaderboards section — XP rules, badges, challenges and leaderboards by batch or course — driven only by events from other modules. Use for XP, badges, challenges and leaderboards.
model: opus
effort: high
isolation: worktree
---

# Agent: gamification

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- gamification 3108`

**You own:** `src/modules/gamification/`, `src/app/[uni]/admin/leaderboards/`, `src/app/[uni]/learn/leaderboard/`, `tests/gamification/`. Table prefix `gam_`.

**Permissions:** `leaderboard.manage`, `leaderboard.view` for staff; `self.view_xp` for students.

**PRD:**
- page 4: User Leaderboards, the XP system: XP rules, badges, challenges, leaderboard.
- page 8: XP rules decide what earns points, such as finishing a lesson or passing a test; badges for milestones and time-bound challenges; leaderboard ranked by batch or by course; learners view XP and leaderboard.
- page 3: HOD has own-department access; permanent faculty can view.
- page 10: phase 2.

You never call other modules. Everything you react to arrives as an event. The emitting modules may not be merged into your branch, so your tests insert events with `emit` and run `drainEvents()`.

## Must have

1. **XP rules.**
   - Choose an event type and points, plus optional conditions:
     - `test.submitted` with `passed` or `scorePercent ≥ N`
     - `attendance.marked` with status present
     - `assignment.submitted` not late
     - `assignment.graded` with `scorePercent ≥ N`
     - `lesson.completed`
     - `enrolment.completed`
   - A daily cap per rule. Scope: whole university, or a department (HODs only for their own).
2. **Awarding.**
   - A handler on all source events writes to `gam_xp_ledger`, unique on (source event id, rule id, user id), then emits `xp.awarded`.
   - Applying a new rule to past events: an admin action that replays matching rows from core `domain_events` (read only) through the same idempotent path.
3. **Badges.**
   - Milestones on counts or XP: first test passed, 10 lessons, a 4-week attendance streak, 500 XP.
   - Choose from a built-in set of simple SVG icons in brand colours.
   - Awarded once, with a notification.
4. **Challenges.**
   - A time-bound goal (start, end, metric, target) scoped to a batch or course.
   - Live progress for each student, and winners listed at the end.
5. **Leaderboards.**
   - By batch or by course, for this week, this month or all time. Ties share a rank.
   - The university chooses how student names show: full name, or first name plus initial.
6. **Staff pages:** XP rules, Badges, Challenges and Leaderboard under `/[uni]/admin/leaderboards/`. HODs are limited to their department. Faculty view only.
7. **Learner side:**
   - `/[uni]/learn/leaderboard`: my XP, rank in each of my batches, badges, active challenges.
   - Slots `learnerHubSections.xp`, `learnerHomeCards.xp`, `learnerCourseTabs.leaderboard`, `dashboardCards.top-learners`.
8. **Seed:** sensible default rules and badges, plus XP for seeded students produced by emitting the seed's events and draining them, so leaderboards aren't empty.

## Rules that need tests
- The same event delivered twice awards once.
- Daily caps hold.
- A department rule never awards students of another department.
- A HOD can't create university-wide rules.
- Leaderboard order and ties are correct.
- Name display follows the setting.

## Out of scope
Rewards with money value, cross-university leaderboards (marketplace, phase 3), and streak push notifications beyond in-app notifications.

## Contracts
- **Uses:** events `test.submitted`, `attendance.marked`, `assignment.submitted`, `assignment.graded`, `lesson.completed`, `enrolment.completed`, `enrolment.switched`; core API (`studentEnrolments`, `batchStudentIds`, `peopleLite`, `notify`); core table `domain_events` read only for backfill; slots.
- **Provides:** event `xp.awarded`, and the slots above.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/gamification.md`.
