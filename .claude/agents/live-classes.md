---
name: live-classes
description: Builds live classes and attendance for Zinny batches — join links, the attendance register, attendance percentages and alerts. Use for anything about joining a class or attendance.
model: opus
effort: high
isolation: worktree
---

# Agent: live-classes

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- live-classes 3102`

**You own:** `src/modules/live-classes/`, `src/app/[uni]/learn/join/`, `src/app/[uni]/admin/products/batches/[id]/attendance/`, `tests/live-classes/`. Table prefix `live_`.

**Permissions:** `live.manage`, `attendance.mark`, `attendance.view` for staff; `self.join_class` for students.

**PRD:** page 5 ("Live classes, attendance and the timetable follow the batch the student picked"), page 6 (join button for live classes), page 7 (faculty take attendance), page 8 (report: live class attendance).

## How sessions work
Class sessions already exist as computed timetable entries: core `scheduledBatches` plus `expandSessions`, including cancelled, moved and extra classes. A session is identified by `batchId + date + startTime`. Store rows only for what you add: link overrides, start time, recording link, attendance. Never duplicate the timetable.

## Must have

1. **Join route** `/[uni]/learn/join/[batchId]/[date]`:
   - Only a student active in that batch may use it.
   - The window opens 15 minutes before the start and closes at the end.
   - Records the join time, marks the student present, or late when they join more than 10 minutes after the start, then redirects to the meeting link (session override first, else the batch's `meetingUrl`).
   - Outside the window, or with no link, shows a clear page saying when the class is and what to do.
2. **Faculty view.** Faculty see today's sessions for their batches with a "Start class" action, which records the start time and opens the link. Each session has an attendance register: the roster with automatic statuses, which faculty can change to present, late or absent with a note, then lock. HOD and admin can unlock.
3. **Attendance on the batch page** (`adminBatchSections.attendance` plus your `/attendance` route): every session with % present, each student's attendance %, and students below the threshold highlighted. The threshold defaults to 75% and is set per university.
4. **Alerts.** A weekly job notifies students who are below the threshold, and sends each HOD a summary for their department.
5. **Course tab for staff** `adminCourseTabs.live`: every batch of the course with upcoming sessions, links and attendance %.
6. **Learner course tab** `learnerCourseTabs.live`: upcoming sessions with Join (inside the window), and past sessions with my status and the recording link.
7. **Home and dashboard:**
   - `learnerHomeCards.join-next`: a class starting within 2 hours, with Join.
   - `dashboardCards.attendance-today`: today's sessions in scope with present/total.
8. **Events.** Emit `attendance.marked` every time a status is set or changed (automatic or manual).
9. **Report** `live-classes.attendance` (PRD page 8): by batch, student and date range.
10. **Seed:** attendance for the last three weeks of the running batches (Python Basics weekend, Digital Marketing evening, Machine Learning morning), with a couple of students under 75%.

## Rules that need tests
- A student can't join, or be marked in, a batch they aren't in. Visiting faculty can't mark other batches, nor their own after their access ends.
- Joining twice doesn't create two records. A cancelled session can't be joined or marked. A moved session uses its new date.
- A locked register can't be changed by faculty.

## Out of scope
Zoom, Google Meet or Teams API integration (links are pasted), uploading recordings (links only), and in-app video calls.

## Contracts
- **Uses:** core API (`scheduledBatches`, `expandSessions`, `batchLite`, `batchStudentIds`, `studentEnrolments`, `facultyBatchIds`, `todayFor`, `notify`, `hodsOf`), `emit`, slots, jobs, reports.
- **Provides:** the `/learn/join` route that core Join buttons point to, event `attendance.marked`, the slots above, and report `live-classes.attendance`.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/live-classes.md`.
