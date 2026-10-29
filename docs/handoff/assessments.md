# assessments handoff

Branch `agent/assessments`, from `foundation-v1`. Port 3101. Screenshots are in `docs/handoff/assessments/` (desktop, plus learner screens at 390 px).

## Built

Everything on the brief's "Must have" list works end to end in the browser. A Playwright click-through ran 29 checks with no page errors.

1. **Question pool** (`/[uni]/admin/products/tests/pool`)
   - Each department has a pool; admins also see a university-wide pool.
   - Five question types: single choice, multiple choice (all or nothing), true/false, numeric (with tolerance) and short answer (graded by hand).
   - Each question has marks, negative marks, difficulty, tags and an explanation.
   - Search by text, and filter by tag, type and difficulty, with pages.
   - CSV import checks every row first and saves nothing unless every row is valid. Questions already in the pool are skipped, so importing the same file twice is safe.
   - Removing a question archives it. Attempts keep their own copy of every question.
2. **Who can write**
   - Admins write anywhere.
   - HODs write in their own department's pool.
   - Faculty add to and use the pool of any department where they teach a batch, and edit or remove only the questions they wrote.
3. **One tests list** with a type filter (quiz, mock test, test series), course and title search.
   - A test is for a whole course (including batches added later) or for specific batches.
   - Faculty can only target their own batches. Faculty see a course-wide test but can't change it.
4. **Inside a test**
   - **Questions:** pick from the pool, reorder, and add draw rules ("8 random medium questions tagged SQL", from a chosen pool). Each student gets their own random draw.
   - **Proctoring:** time limit, full screen, tab-switch limit with auto-submit, shuffle questions and options, one question per page, attempt limit, and the open and close window (entered in the university's time zone).
   - **Settings:** title, type, targets, pass mark, when answers are shown, instructions, publish or unpublish, and delete. Publishing checks that the test is ready, and notifies the students of its batches.
   - **Results:** attempts per student, best score, pass rate, % correct per question, a filter by batch, and a full view of each attempt with its proctoring log.
5. **Test series:** an ordered set of tests of one course. Learners see it as one item, and its tests stay hidden while the series is a draft.
6. **Taking a test** (`/[uni]/learn/tests`, mobile first)
   - The list shows available, upcoming and completed tests.
   - Before starting, a page shows the rules and past attempts.
   - The player covers the whole screen. Its timer counts down to the server's end time, corrected for a wrong device clock. Every answer saves on each change, and the test resumes after a reload.
   - Leaving the tab or full screen is recorded on the server.
   - The result page follows the "when answers are shown" setting.
7. **Grading**
   - Objective questions are marked automatically.
   - Short answers go to the grading queue (`/tests/grading`) of whoever holds `assess.grade` on the student's batch.
   - `test.submitted` is emitted once, with the final score, when nothing is left to grade. The student is notified when a graded result is ready.
   - A job, `assessments.close-expired-attempts`, runs every minute and submits attempts whose time ran out while the student was away.
8. **Slots:** all six reserved keys and orders (see below).
9. **Report** `assessments.test-scores`, with date range, course and batch filters, scoped by `reach`.
10. **Seed**
    - A 40-question Data Analytics pool (26 written by Hema, 14 by Farah).
    - Tests: a quiz, a proctored mock test using draw rules, a 3-test weekly series, and Farah's quiz for the morning batch only.
    - Attempts: 10 graded, 1 waiting for Farah to grade, and 1 in progress (Ishaan, on the mock test).

**Integrity rules, each with a test:**
- The paper sent to the browser has no answers or explanations; the tests check the actual responses.
- Answers that arrive after the end time are refused, and the attempt is submitted.
- The attempt limit holds against three tabs starting at the same moment, through a unique attempt number and one open attempt per student.
- Students never see or start tests for batches they aren't in.
- Faculty never see or grade attempts from other batches, even on a course-wide test.

**Tests:** 79 in `tests/assessments/` (7 files). They cover allow and deny cases for every permission, and isolation for all 8 tables. The full suite has 228 tests, and all pass.

## Not built (and why)
- Webcam proctoring, AI question generation, essays longer than a short answer, and certificates are out of scope in the brief.
- Images in questions are not supported. The brief doesn't ask for them, and they would need `storage()` uploads.
- Detecting a second device is out of scope. The tab-switch and full-screen signals come from the browser, so the server records them but can't prove them.

## Contracts used / provided
- **Emits:** `test.submitted` `{ attemptId, testId, userId, courseId, batchId, scorePercent, passed }`, once per attempt when it is final.
- **Handles:** no events.
- **Slots:**
  - `adminCourseTabs.tests` (400, `assess.view_results`)
  - `adminBatchSections.tests` (400, `assess.view_results`)
  - `learnerCourseTabs.tests` (400, `self.take_test`)
  - `learnerHubSections.test-results` (400, `self.take_test`)
  - `learnerHomeCards.upcoming-tests` (400, `self.take_test`)
  - `dashboardCards.to-grade-tests` (400, `assess.grade`)
- **Report:** `assessments.test-scores` (`assess.view_results`).
- **Job:** `assessments.close-expired-attempts` (every minute).
- **Core API used:** `withTenant`, `audit`, `emit`, `assertCan`, `can`, `reach`, `systemActorFor`, `universityLite`, `getCourseLite`, `batchLite`, `studentEnrolments`, `batchStudentIds`, `peopleLite` and `notify`. Core tables (`courses`, `batches`, `departments`) are only read with `select`.

## New packages
None.

## New environment variables
None (see `src/modules/assessments/ENV.md`).

## Requests for other owners
- **Core (learner layout):** the learner tab bar is `fixed` at `z-20`. The test player now covers the whole screen at `z-40` so the bar can't be tapped mid-test. A `focusMode` option for the learner layout would be cleaner.
- **Core (contracts):** `facultyBatchIds` isn't used. Faculty reach comes from `reach()`, which already covers HODs and admins.
- **reports-board:** the report's `percent` column is 0–100. Marks columns are plain numbers and can be negative, because of negative marking.

## Known issues
- `npm run build` was not run (by instruction), so the pages have been checked with `next dev` and `tsc` only.
- Moving to the new draw-rule column needs `npm run db:reset` on dev databases pushed before this change. The integrator's migration should simply create the tables.
- If a pool question is edited after a test is published, attempts already started keep the old text. The "% correct per question" view groups by pool question, so it mixes old and new versions.
- `onePerPage` only changes how questions are shown. Students can still go back to earlier questions; locking questions in order isn't in the brief.
