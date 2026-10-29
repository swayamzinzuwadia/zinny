# live-classes handoff

Branch `agent/live-classes`, from `foundation-v1`. Dev port 3102. Screenshots are in `docs/handoff/live-classes/`, at desktop width, with learner screens also at 390 px.

## Built

Every "Must have" item in the brief is built and works end to end in the browser. A Playwright run against the seeded demo made 36 checks, and all passed.

**How sessions work.** A class session is computed from the timetable (core `scheduledBatches` plus `expandSessions`) and identified by batch, date and start time. Cancelled classes don't exist; moved classes exist on their new date. The module stores only what it adds:
- `live_sessions`: a per-class link, the recording link, who started the class and when, and the lock.
- `live_attendance`: one row per student per class.
- `live_settings`: the threshold per university.
- `live_alerts`: who was alerted in which week.

A class counts towards percentages only once it has been run through Zinny: started, joined, marked or locked. A batch that holds its classes somewhere else never shows 0%.

1. **Join route** `/[uni]/learn/join/[batchId]/[date]` (optional `?start=HH:MM` when a batch has two classes in a day).
   - Only a student active in the batch can use it.
   - The window runs from 15 minutes before the start to the end.
   - Joining records the join time and marks the student present, or late if they join more than 10 minutes after the start. The student is then redirected to the class's own link, or else the batch's. Only http(s) links are followed.
   - Joining again keeps one row and counts the joins.
   - If staff marked the student absent before they had joined, a later join gives them the status the join earns.
   - Every other case gets a clear page saying when the class is and what to do: too early (the Join button switches on when the window opens), ended (with the recording), no link, cancelled, moved (links to the new date), no class that day, or not in this batch.
2. **Faculty view.**
   - The dashboard card lists today's classes with **Start class** and **Take attendance**.
   - Start class is a POST that records the first start and opens the meeting in a new tab. It's available from an hour before the class, and it refuses cross-site requests.
   - Register page `…/attendance/[date]`: the roster with automatic statuses, Present / Late / Absent and a note per student, "mark the rest", lock, and unlock for HOD and admin. It refreshes every 30 seconds during a class and keeps unsaved edits.
   - Locking marks students without a status absent.
   - The register page also edits the per-class meeting link and the recording link.
3. **Batch attendance.**
   - The `adminBatchSections.attendance` section and the `/attendance` page show every class with % present and each student's %.
   - Students below the threshold are highlighted.
   - The threshold defaults to 75%. An Institute Admin sets it on the attendance page; it applies university-wide.
4. **Alerts.** The `live-classes.weekly-alerts` job runs daily and acts once a week, from Monday.
   - Each student below the threshold in a batch gets an alert, once they've had at least 3 recorded classes.
   - Each HOD gets one summary for their department.
   - `live_alerts` makes sure each person is alerted at most once a week.
   - A second job, `live-classes.close-sessions`, runs hourly and marks no-shows absent once a recorded class ends.
5. **Course tab** `adminCourseTabs.live`: every batch in reach, with its upcoming classes, link, attendance % and the number of students below the threshold.
6. **Learner course tab** `learnerCourseTabs.live`: my attendance %, upcoming classes (Join inside the window), and past classes with my status, join time, note and recording. Past classes include the student's earlier batch if they switched.
7. **Home and dashboard.**
   - `learnerHomeCards.join-next`: a class that's on now or starts within 2 hours, with a window bar and Join or Rejoin.
   - `dashboardCards.attendance-today`: today's classes in the viewer's scope, with present / total.
8. **Events.** `attendance.marked` is emitted for every status set or changed: a join, staff marking, lock, or the hourly job. It isn't emitted when nothing changed, or for a rejoin.
9. **Report** `live-classes.attendance`: one row per student per batch, filtered by date range, department, course and batch. Scoped viewers see only their own scope (checked with `reach`).
10. **Seed.** Three weeks of the three running batches, created through the services as the real people:
    - ML Morning: students join through Zinny, Farah starts each class and marks absences.
    - Python Weekend and Marketing Evening: registers are taken by the faculty, and upcoming classes get their own links.
    - There are recordings, and every week before this one is locked.
    - Below 75%: Zoya (50%) and Rohan (61%) in ML, and Neil (67%) in Python. This week's alerts are sent.

**Tests:** 73 in `tests/live-classes/`; the full suite has 227. They cover:
- the time rules (window edges, late cut-off, midnight, daylight saving);
- join allow and deny;
- joining twice, including concurrent joins;
- cancelled and moved classes, batch switches and unsafe links;
- register marking, lock and unlock, Board view-only, other HOD, other faculty, and visiting faculty before and after their access ends;
- students who enrolled after a class;
- the threshold;
- overviews, both jobs, the report and slot registration and rendering;
- isolation tests for all four tables.

## Not built (and why)
- Zoom, Meet and Teams integration, recording uploads and in-app video: out of scope in the brief. Links are pasted.
- Per-department thresholds: the brief says per university.
- Parents can't see their child's attendance. There's no slot or contract for it.

## Contracts used / provided
- **Uses (core API):**
  - `withTenant`, `audit`, `emit`, `assertCan`, `can`, `reach`, `hasRole`
  - `universityLite`, `peopleLite`, `batchLite`, `getCourseLite`, `courseTarget`
  - `scheduledBatches`, `expandSessions`, `batchStudentIds`, `studentEnrolments`
  - `notify`, `hodsOf`
- **Reads core tables directly:** `batches`, `courses`, `departments` (for reach-scoped lists), `enrolments` and `batch_switch_requests` (when a student joined a batch, so they aren't marked absent for classes held before that).
- **Provides:**
  - the `/learn/join` route that core Join buttons point to;
  - event `attendance.marked`;
  - slots `adminCourseTabs.live`, `adminBatchSections.attendance`, `learnerCourseTabs.live`, `learnerHomeCards.join-next` and `dashboardCards.attendance-today`;
  - report `live-classes.attendance`;
  - jobs `live-classes.close-sessions` (hourly) and `live-classes.weekly-alerts` (daily).
- **Handles no events.**

## New packages
None.

## New environment variables
None (see `src/modules/live-classes/ENV.md`). Production cron must call `/api/jobs/run?every=hour` as well as `?every=day`.

## Requests for other owners
- **Core, timetable and home:** the student timetable and home hero show Join only when the batch has a `meetingUrl`. Classes whose link is set per class (Python Weekend and Marketing Evening in the seed) get no Join there. They do get it on my course tab and home card. Request: show Join for every class (the join route explains a missing link), or expose a per-class link in `Session`.
- **Core, home hero:** the Join on the hero shows from the start of the day, and the join route then explains it's too early. Showing it from 15 minutes before would match the window.
- **notifications-delivery:** please add the kinds `attendance.low` (to students) and `attendance.low_summary` (to HODs) to templates and preferences.
- **Integrator:** the migration needs the four `live_` tables and the enums `live_attendance_status` and `live_attendance_source`.

## Known issues
- A student who leaves a batch keeps their past rows, and they still count in that batch's history. A completed enrolment has no Join, but its past classes stay visible.
- Present, late and absent are recorded only for students active in the batch, plus anyone already on the register. A student removed from a batch can't be marked retroactively.
- When a class is cancelled after it was recorded, its rows stay in the database but drop out of every view and percentage, by design.
- The register and attendance pages refresh with `router.refresh()`, not live updates.
