# assignments-polls handoff

Branch `agent/assignments-polls`, from `foundation-v1`. Everything is in `src/modules/assignments-polls/` plus the routes listed below.

## Built

**Assignments (staff)**
- **Setting work.** An assignment is set for every batch of a course (including batches added later) or for chosen batches. It has:
  - a title and rich-text instructions: a small editor whose HTML is sanitised with `sanitize-html` when saved and again when shown;
  - attachments;
  - a due date and time in the university's time zone, stored as an instant;
  - points from 1 to 1000;
  - late work refused or accepted, with a 0–100% penalty;
  - a hand-in type (text, files or both), a file count from 1 to 10 and a size limit from 1 to 25 MB.
- **Who.** Faculty manage work for their own batches, HODs for their department, admins everywhere. Checks are per batch, through the engine. Setting work for every batch, editing or deleting needs `assignment.manage` on every covered batch.
- **Editing.** You can't drop a batch that already has work in it, and points are locked once anyone is graded. Moving the due date re-checks which ungraded work was late. Deleting removes the stored files too.
- **Pages**
  - The course **Assignments** tab: a table with "handed in" and "to grade" counts, and a New assignment button.
  - `/[uni]/admin/products/assignments`: every assignment you can see, with work to grade first.
  - `…/new?course=` and `…/[id]/edit`: the create and edit forms.
  - `…/[id]?batch=&student=`: the **grading queue**. It shows one batch at a time (a tab per batch). Work to grade comes first, oldest first, then students who handed nothing in, then graded students. The selected student's latest version is shown, with earlier versions below. The grade form takes marks (decimals allowed), feedback and optional returned files, and has a "Save and grade <next>" button.
- **Grading rules.** The late penalty is applied automatically: final marks = marks × (100 − penalty)%. Students with no work can be graded too, for paper work or a zero. View-only staff (board) see status and marks but not the work itself.

**Assignments (students, mobile first)**
- `/[uni]/learn/assignments` lists work under To do (due or overdue), Handed in, Graded and Missed.
- The assignment page shows the due date (gold when due within a day), the instructions, the teacher's files, your work and its versions, the hand-in form, and your grade with feedback and any returned files.
- **Handing in:** text and files, again and again until the due date, with every version kept. On a new version you can keep files from the last one.
- **After the due date:** refused when the assignment doesn't take late work. When it does, you can hand in once; the work is marked late and the penalty comes off at grading.
- A student only ever sees and reaches assignments for their own batch.

**Files**
- **Uploads.** The browser sends each file in 4 MB parts to `…/upload`, so files up to 25 MB fit under Vercel's request limit. The part route reads at most 4 MB and refuses requests from other sites. A form then claims its uploaded files. Uploads nobody saved are removed by the daily job, and one person may have at most 30 unsaved uploads.
- **Storage keys** are `<universityId>/assignments-polls/files/<fileId>/<safe name>`. A database check refuses any other prefix.
- **Opening a file.** Pages link to `…/files/<fileId>`. That route checks access on every click and redirects to a signed URL that works for 120 seconds; the file always downloads as an attachment.
- **Who opens what:**
  - Submitted and returned files: the student, the batch's graders (its faculty, the HOD, admins). Staff opening a student's file is audited.
  - Attachments: anyone the assignment is for.
  - Everyone else gets 404.

**Polls**
- **Creating.** A single-choice poll for a course or one batch, with 2–10 options, open and close times, an anonymous option and "show results to students after it closes". The course **Polls** tab shows results bars, who voted (on named polls, only for the batches you manage), close now and delete.
- **Voting.** Students vote once from the course hub's Assignments tab or `/[uni]/learn/polls`. A primary key on `poll_voters` keeps it at one vote even under races.
- **Anonymous polls** store ballots without the voter, and the audit entry never names the option.
- **Results** reach students only after the poll closes, as totals with no names.

**Notifications** (core `notify`)
- A new assignment notifies its students.
- The daily job reminds students who haven't handed in, the day before the due date, once per due date.
- Grading notifies the student.
- A poll that opens notifies its students: at once, or through the hourly job.

**Seed**
- Two assignments per running batch (Python ×2 batches, ML Morning, DM Evening), with:
  - graded work (feedback, a returned file, late penalties),
  - work waiting for a grade,
  - students who handed nothing in, and one recorded zero.
- PDFs are generated locally.
- One closed course-wide poll with 7 votes, and one open anonymous poll.

**Tests:** 70 in `tests/assignments-polls/` (6 files). Full suite: 219 passed in 20 files.

## Not built (and why)
- Plagiarism checks, peer review, rubrics and zip download: out of scope in the brief.
- No report for the Reports page: the brief doesn't ask for one, and the PRD's required reports belong to other modules. An "assignment grades" report would be a small addition.
- The admin menu has no "Assignments" link: the menu is core. Staff reach `/admin/products/assignments` from the dashboard card. Its natural home is the course tab.

## Contracts used / provided
- **Emits** `assignment.submitted` `{ submissionId, assignmentId, userId, batchId, late }` on every hand-in, versions included, and `assignment.graded` `{ …, scorePercent }` when a grade is new or its final marks change.
- **Handles** `enrolment.switched` (`assignments-polls.follow-batch-switch`): ungraded work moves to the new batch so its faculty grade it, when the assignment covers that batch. Otherwise the work stays with the old batch's graders, and the student still sees it read only.
- **Slots:**
  - `adminCourseTabs.assignments` (300, `assignment.view`)
  - `adminCourseTabs.polls` (310, `poll.manage`)
  - `adminBatchSections.assignments` (300)
  - `learnerCourseTabs.assignments` (300, `self.submit_assignment`; also shows the course's polls)
  - `learnerHubSections.assignment-grades` (300; renders nothing until something is graded)
  - `learnerHomeCards.due-soon` (300; work due within 7 days, overdue work still accepted, polls to vote in; nothing when empty)
  - `dashboardCards.to-grade-assignments` (300, `assignment.grade`)
- **Jobs:** `assignments-polls.daily` (day: reminders, removing unsaved uploads) and `assignments-polls.announce-polls` (hour).
- **Core API:** `withTenant`, `audit`, `emit`, `assertCan`, `can`, `reach`, `getCourseLite`, `batchLite`, `listCourseBatches`, `batchStudentIds`, `studentEnrolments`, `peopleLite`, `universityLite`, `notify`, `storage`. Core tables `batches`, `courses` and `enrolments` are read directly for names, rosters and seat lookups.

## New packages
- `sanitize-html` 2.18.1 and `@types/sanitize-html` 2.16.0 (dev). 2.18.x fixes three XSS advisories in 2.17.

## New environment variables
None. See `src/modules/assignments-polls/ENV.md`; it uses core storage and `CRON_SECRET`.

## Requests for other owners
- **Core (menu):** add "Assignments" under Products, linking to `/products/assignments`, for roles with `assignment.view`.
- **Core (learner nav):** add an entry for `/[uni]/learn/assignments`. Students reach it today from the home card, the course hub tab, the My learning grades section and notifications.
- **notifications-delivery:** this module's notification kinds are `assignment.new`, `assignment.due_soon`, `assignment.graded` and `poll.open`. Each carries `data.href`.
- **gamification:** `assignment.submitted` fires again for every resubmitted version, so de-duplicate XP on `submissionId`. `assignment.graded` fires again when a grade changes.

## Known issues
- The **due-soon reminder** is a daily job. Work set on the day it's due gets a "due today" reminder only if the job runs before the deadline.
- **Uploads:** a file stays staged until its form is saved. If someone uploads and closes the tab, the file is removed within 24 hours.
- **Rich text** uses `document.execCommand`. It is deprecated but works in every current browser; a future editor swap only touches `components/rich-text-editor.tsx`.
- **Anonymous ballots:** `poll_votes` has no voter column or timestamp. The table's physical row order could still hint at vote order to someone with direct database access.
