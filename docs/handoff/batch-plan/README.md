# batch-plan handoff

## Built
- Batch incharge (`batches.incharge_user_id`): picker at the top of the batch page, shown on the course page's batch cards and on the learner's course hub and full timetable.
- Sections with their own faculty (`batch_sections`) and a day-number plan (`batch_plan_days`), edited on the batch page's "Sections and plan" tab: add, edit, reorder, remove, faculty per section, days as ranges (`1-5, 8, 10-12`), topic and optional own times per day, a Day 1…N grid that shows gaps, shared days and days past the end date, and "Copy the plan from another batch".
- The dated timetable is computed on every read (`batchTimetable` in `src/server/services/schedule.ts`); nothing dated is stored. "Timetable" tab: warnings with fixes, filters by section and faculty, print layout, CSV download (`…/batches/[id]/timetable.csv`).
- Learner: week view, day agenda and upcoming list show section, its faculty and topic; `learn/my/[enrolmentId]` shows the incharge and the next class; `learn/my/[enrolmentId]/timetable` is the full timetable.
- Services in `src/server/services/batch-plan.ts`; every write checks `batch.update`, runs in `withTenant` and is audited. Students get one `timetable.changed` notification per save, only when their upcoming days look different.

## Not built (and why)
- There is no faculty timetable page in the app (`facultyTimetable` has no caller). The service now returns each session's section and `taughtByMe`; the batch page's week view and Timetable tab mark the viewer's own classes ("You teach", "Only my classes").
- Batch-switch requests only notify HODs today (not batch faculty), so there was nothing to mirror for the incharge. Enrolment requests do reach the incharge.

## Contracts used / provided
- `Session` gained optional `dayNumber`, `section`, `sectionFaculty`, `topic`, `taughtByMe`. `studentTimetable` and `facultyTimetable` fill them; `scheduledBatches` and `expandSessions` are unchanged.
- `src/server/core/index.ts` not changed.

## New packages
None.

## New environment variables
None.

## Requests for other owners
- `src/components/week-view.tsx`: one small addition (the section line under the course title).
- `src/server/services/enrolment.ts`: `approversOf` also includes the batch's incharge (two lines).

## Known issues
- A class day shared by a section with its own times and one without: the one without takes the whole class time.
- The incharge is told about enrolment requests, but can only act on them if their role already allows it (HOD, admin, or faculty on that batch).

Screenshots in this folder: 01–14 admin (desktop 1440, tablet 820), 20–23 learner (desktop and 390 px).
