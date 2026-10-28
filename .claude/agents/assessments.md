---
name: assessments
description: Builds Zinny's tests, quizzes, test series and question pool, for staff and for learners. Use for anything under Products → Tests or taking a test.
model: opus
effort: high
isolation: worktree
---

# Agent: assessments

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- assessments 3101`

**You own:** `src/modules/assessments/`, `src/app/[uni]/admin/products/tests/`, `src/app/[uni]/learn/tests/`, `tests/assessments/`. Table prefix `assess_`.

**Permissions:** `assess.manage`, `assess.grade`, `assess.view_results` for staff; `self.take_test` for learners (contracts.md section 9).

**PRD:** page 4 (Tests with question pool, quizzes, proctoring), page 7 (one list for mock tests and test series with a type filter; every question lives in one pool; inside a test: Questions, Proctoring, Settings, Results), page 8 (learner takes tests, sees grades), page 10 (phase 1).

## Must have

1. **Question pool.** Every department has a pool, and admins also see a university-wide pool. Question types: single choice, multiple choice, true/false, numeric (with tolerance) and short answer (graded by hand). Each question has marks, optional negative marks, difficulty, tags and an explanation. Search and filter by tag, type and difficulty. Bulk import by CSV, checking every row first (same pattern as the core people import).
2. **Who can write.** Admins can write anywhere. HODs write in their own department's pool. Faculty can add to and use the pool of any department where they teach at least one batch.
3. **One tests list** with a type filter: quiz, mock test, test series. A test is attached to a course (all its batches) or to specific batches. Faculty may only create tests for their own batches.
4. **Inside a test**, these tabs:
   - **Questions:** pick from the pool, or add draw rules ("8 random medium questions tagged SQL").
   - **Proctoring:** time limit, full screen required, tab-switch limit with auto-submit, shuffle questions and options, one question per page, attempt limit, open and close window.
   - **Settings:** title, type, targets, pass mark %, when answers are shown (never, after submit, after the window closes), publish.
   - **Results:** attempts per student, scores, and % correct per question.
5. **Test series:** an ordered set of tests, shown as one item to learners.
6. **Taking a test** (`/[uni]/learn/tests`, mobile first):
   - Lists available, upcoming and completed tests for the student's own batches.
   - The timer is enforced by the server's end time. Answers autosave on every change, and the test resumes after a reload.
   - The test auto-submits at time-out, enforced on the server. Proctoring events (tab switches, leaving full screen) are recorded on the server.
   - The result page follows the "when answers are shown" setting.
7. **Grading.** Objective questions are graded automatically. Short answers go to a grading queue for whoever holds `assess.grade` on that batch. Emit `test.submitted` with the final score once nothing is left to grade, or straight away if there's nothing manual.
8. **Slots:** `adminCourseTabs.tests`, `adminBatchSections.tests`, `learnerCourseTabs.tests`, `learnerHubSections.test-results`, `learnerHomeCards.upcoming-tests`, `dashboardCards.to-grade-tests`.
9. **Report** `assessments.test-scores` (PRD page 8), with filters for date range, course and batch.
10. **Seed:** a 40-question pool for Data Analytics, one quiz and one mock test, and a few graded attempts.

## Integrity rules (each needs a test)
- Correct answers never reach the browser before the student is allowed to see them. Check the actual responses in a test.
- Answers sent after the end time are rejected. The attempt limit can't be exceeded, even with two tabs.
- A student never sees tests for batches they aren't in. Faculty never see or grade other batches' attempts.

## Out of scope
Webcam proctoring, AI question generation, subjective essays beyond short answer, and certificates (certificates listens to course completion, not tests).

## Contracts
- **Uses:** core API (`batchLite`, `listCourseBatches`, `facultyBatchIds`, `studentEnrolments`, `batchStudentIds`, `notify`), `emit`, slots, reports.
- **Provides:** event `test.submitted`, the slots above, and report `assessments.test-scores`.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/assessments.md`.
