---
name: assignments-polls
description: Builds assignments (create, submit with files, grade) and course polls for Zinny. Use for anything about assignments, submissions, grading of assignments, or polls.
model: opus
effort: high
isolation: worktree
---

# Agent: assignments-polls

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- assignments-polls 3103`

**You own:** `src/modules/assignments-polls/`, `src/app/[uni]/admin/products/assignments/`, `src/app/[uni]/learn/assignments/`, `src/app/[uni]/learn/polls/`, `tests/assignments-polls/`. Table prefixes `asgn_` and `poll_`.

**Permissions:** `assignment.manage`, `assignment.grade`, `assignment.view`, `poll.manage` for staff; `self.submit_assignment`, `self.vote` for students.

**PRD:** page 7 (Assignments tab inside a course; "Polls can be added to a course"), page 2 (faculty grade only their batches' students), page 8 (learner submits assignments).

## Must have

### Assignments
1. **Creating.** An assignment belongs to a course (all batches) or to specific batches. It has a title, instructions (rich text, sanitised), attachments, a due date and time, points, late submissions (allowed or not, with a penalty %) and a submission type (text, files, or both, with a file count and size limit).
2. **Who manages.** Faculty manage and grade assignments for their own batches; HODs for their department; admins everywhere.
3. **Submitting** (`/[uni]/learn/assignments`, mobile first):
   - Lists due, overdue, submitted and graded work.
   - Students submit text and files, uploaded through `storage()` with keys under `<universityId>/assignments-polls/`.
   - Students can resubmit until the due date; history is kept.
   - Students see their grade, feedback and any returned file.
4. **Grading queue:** per assignment and batch, with marks, feedback and an optional returned file. Unsubmitted students are listed too. Late penalties apply automatically.
5. **Notifications:** a new assignment notifies its students; a daily job reminds students the day before the due date; grading notifies the student.
6. **Files** are only reachable through short-lived signed URLs, and only by the submitting student, that batch's faculty, the HOD and admins.

### Polls
7. **Creating.** A single-choice poll on a course or batch, with open and close times and an anonymous option. Results go to staff, and to students after the poll closes if allowed.
8. **Voting.** Students vote once, from the course hub or `/[uni]/learn/polls`.

### Shared
9. **Slots:** `adminCourseTabs.assignments`, `adminCourseTabs.polls`, `adminBatchSections.assignments`, `learnerCourseTabs.assignments`, `learnerHubSections.assignment-grades`, `learnerHomeCards.due-soon`, `dashboardCards.to-grade-assignments`.
10. **Events:** `assignment.submitted` (with `late`) and `assignment.graded` (with `scorePercent`).
11. **Seed:** two assignments per running batch, with a mix of graded, submitted and missing work, and one closed poll with results.

## Rules that need tests
- A student never sees or submits to another batch's assignment.
- Submitting after the due date is refused when late work isn't allowed, and gets the penalty when it is.
- Faculty of another batch can't grade, and can't open the files.
- Voting twice is refused.
- Storage keys always start with the university id.

## Out of scope
Plagiarism checks, peer review, rubrics with criteria (marks and feedback only for now), and bulk download as a zip (nice to have only after must-haves).

## Contracts
- **Uses:** core API (`batchLite`, `listCourseBatches`, `batchStudentIds`, `studentEnrolments`, `facultyBatchIds`, `notify`, `storage`), `emit`, slots, jobs.
- **Provides:** events `assignment.submitted` and `assignment.graded`, and the slots above.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/assignments-polls.md`.
