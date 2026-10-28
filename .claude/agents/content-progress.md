---
name: content-progress
description: Builds Zinny's course curriculum editor, lesson player and learner progress, and decides when a course is complete. Use for lessons, curriculum, video/PDF content and progress tracking.
model: opus
effort: high
isolation: worktree
---

# Agent: content-progress

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- content-progress 3104`

**You own:** `src/modules/content-progress/` (foundation-lock already moved the curriculum tables and Curriculum tab here), `src/app/[uni]/admin/products/content/`, `src/app/[uni]/learn/lessons/`, `tests/content-progress/`. Table prefix `content_`.

**Permissions:** `content.manage`, `content.view_progress`, `enrolment.complete` for staff; `self.learn` for learners.

**PRD:** page 4 (courses with curriculum), page 5 (HOD creates the course with its curriculum), page 7 (Curriculum tab), page 8 (report: course and batch progress), page 2 (faculty teach content).

## Must have

1. **Curriculum editor** (Curriculum tab, plus your `/admin/products/content` routes):
   - Sections and lessons: add, rename, reorder and delete.
   - Lesson kinds:
     - video: upload through `storage()`, or a YouTube or Vimeo link
     - PDF: upload
     - text: rich text, sanitised
     - external link
     - live: points to the batch's live classes; no content of its own
   - Each lesson is required or optional, and has a duration.
2. **Drip.** A lesson unlocks N days after the student's batch start date, or on a fixed date.
3. **Who edits.** `content.manage` holders: admins, HODs for their department, and faculty for courses where they teach a batch.
4. **Lesson player** `/[uni]/learn/lessons/[lessonId]` (mobile first):
   - Plays video, shows PDFs through a signed URL, and renders text. Next and previous buttons.
   - Locked lessons show when they open.
   - Videos mark themselves complete at 90% watched; PDFs and text have a "Mark complete" button.
5. **Progress.**
   - Store progress per lesson and per course.
   - Course % = completed required lessons ÷ required lessons.
   - Emit `lesson.completed` and `course.progress` when they change.
   - At 100%, call core `markEnrolmentCompleted`, which emits `enrolment.completed`. It must happen once only.
6. **Staff progress view:** per batch, every student with %, last activity and a "Mark complete" action (`enrolment.complete`) for courses finished offline.
7. **Slots:** `adminCourseTabs.curriculum` (keep it working from day one), `learnerCourseTabs.lessons`, `learnerHomeCards.continue-learning` (the next unfinished lesson).
8. **Report** `content-progress.course-batch-progress` (PRD page 8): progress by course and batch, with completion counts.
9. **Seed:** full curricula (sections, a mix of lesson kinds) for every seeded course, and realistic progress for seeded students, with at least one student at 100% on Python Basics so the completion flow runs.

## Rules that need tests
- A student can't open lessons of a course they aren't actively enrolled in, or a locked drip lesson. The signed-URL route refuses them too.
- Faculty can't edit a course they don't teach.
- Completion fires exactly once, even when the last two lessons complete at the same moment.
- Optional lessons don't count toward the percentage.

## Out of scope
Video transcoding, DRM or download protection, SCORM, AI-generated lessons, and discussion threads.

## Contracts
- **Uses:** core API (`getCourseLite`, `courseTarget`, `batchLite`, `studentEnrolments`, `enrolmentById`, `markEnrolmentCompleted`, `storage`), `emit`, slots, reports.
- **Provides:** events `lesson.completed` and `course.progress`, completion through `markEnrolmentCompleted`, the slots above, and report `content-progress.course-batch-progress`.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/content-progress.md`.
