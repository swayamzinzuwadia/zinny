# content-progress handoff

Branch `agent/content-progress`, from `foundation-v1`. Port 3104. Screenshots are in `docs/handoff/content-progress/`.

## Built

**Curriculum editor** (Curriculum tab on the admin course page, and `/[uni]/admin/products/content/lessons/[lessonId]`)
- Sections: add, rename in place, move up and down, delete (with their lessons, files and progress).
- Lessons: add (title, type, required or optional), rename, move up and down, move to another section, delete, change type.
- Lesson types:
  - Video: upload an MP4, WebM or MOV file (up to 250 MB) through `storage()`, or paste a YouTube or Vimeo link (including unlisted Vimeo links with a hash).
  - PDF: upload (up to 50 MB).
  - Text: rich text editor (TipTap). The HTML is sanitised with sanitize-html when saved and again when shown.
  - Link: http(s) only.
  - Live: no content of its own; it shows the batch's next classes, with a Join button on class days.
- Each lesson has required or optional, a duration in minutes, and a drip rule: open at enrolment, N days after the student's batch starts, or on a fixed date.
- A lesson without content is marked "Needs content". It is hidden from students and doesn't count toward progress.
- Uploads go in 4 MB parts (each request stays under serverless body limits), with retries and a cancel button. The real file type is read from the first bytes. A replaced file is deleted. A daily job removes abandoned uploads.

**Who edits:** every write needs `content.manage` on the course target: admins, HODs for their department, and faculty who teach one of the course's batches. Anyone with `course.view` reads the curriculum, and the edit controls are hidden from them.

**Lesson player** `/[uni]/learn/lessons/[lessonId]`, mobile first
- Video: a signed URL for uploaded files; the YouTube IFrame API or the Vimeo player API for links. Watched second-ranges are reported every 10 seconds and when the learner leaves the page. The server adds them up and completes the lesson at 90% watched. New watched time is capped by the clock time since the last report, so a forged "watched it all" report doesn't count. Playback resumes where the learner stopped.
- PDF: rendered with pdf.js page by page, so it works on phones, with "Open full screen" and "Download" through signed URLs.
- Text: sanitised HTML. Link: opens in a new tab.
- PDF, text, link and live lessons have a "Mark complete" button.
- The page also has next and previous buttons, a course outline with progress, and locked lessons showing when they open.
- File route `/[uni]/learn/lessons/[lessonId]/file` redirects to a fresh signed URL only for an active (or completed) enrolment in an open, ready lesson. Video progress is posted to `/[uni]/learn/lessons/[lessonId]/progress`.

**Progress**
- `content_lesson_progress` stores progress per lesson and learner. `content_course_progress` stores it per enrolment.
- Course % = completed required, ready lessons ÷ required, ready lessons, rounded down.
- Concurrency: every change locks the enrolment's progress row first, so lessons completed at the same moment are counted in order and exactly one of them sees 100%. Curriculum changes lock the same rows in the same order, so the two never deadlock.
- At 100% the module calls core `markEnrolmentCompleted` with the system actor after commit. Two safety nets cover an interrupted step: the `course.progress` handler and an hourly job. Core is idempotent, so `enrolment.completed` fires once.
- Curriculum changes that move percentages recount every enrolment of the course in the same transaction: a required lesson added, removed, made optional, or getting its content.

**Staff progress**
- `/[uni]/admin/products/content`: every course and batch the viewer may see, with students, not started, in progress, completed and average progress.
- `/[uni]/admin/products/content/batches/[batchId]`: each student with %, required lessons done and last activity.
- "Mark complete" for courses finished offline, needing `enrolment.complete`. Faculty see the view without the button.

**Slots, report, seed**
- Slots: `adminCourseTabs.curriculum`, `learnerCourseTabs.lessons` and `learnerHomeCards.continue-learning` (the next unfinished lesson per active course).
- Report `content-progress.course-batch-progress`. It is scoped with `reach`; filters are date range, department, course and batch.
- Seed: full curricula for all four courses, written by Hema, Farah and Neel, using every lesson kind. It includes an uploaded MP4 (`seed-assets/welcome.mp4`, 190 KB, made with ffmpeg), PDFs generated in code, YouTube and Vimeo links, drip by days and by date, and optional lessons.
- Seeded progress covers 24 enrolments. Neil finishes Python Basics, so his enrolment completes through the engine. Hema marks Rohan's Python Basics complete offline.

**Checked in the browser** (Playwright against `npm run dev` on a freshly seeded database; scripts kept outside the repo)
- Staff, as Hema:
  - add a section; add a text lesson, which lands in the editor; write and save text; save settings (optional, 20 minutes, opens 28 days after start)
  - change the type to PDF and upload a PDF through the file input; a fake PDF is refused
  - move the section up; delete the lesson and the section; mark Ishaan complete from the batch view
- Learner, at 1440 px and 390 px: home card, Lessons tab, and text, PDF (pdf.js), video, locked, live and not-enrolled lessons.
- Mark complete moved Riya from 44% to 55% in Digital Marketing.
- Zoya's uploaded video resumed at 50% and completed itself at 90% watched.
- No page errors.
- **Screenshots:** `docs/handoff/content-progress/` (desktop for staff; desktop and 390 px for learners).

**Tests:** 91 in `tests/content-progress/` (6 files). The full suite has 234, all passing.

## Not built (and why)
- Drag-and-drop reordering: the up and down buttons work without JavaScript and on tablets.
- Direct-to-bucket uploads: `storage()` has no presigned PUT (see Requests).
- Out of scope per the brief: transcoding, DRM, SCORM, AI lessons, discussions.

## Contracts used / provided
- **Emits:** `lesson.completed` (once per learner and lesson) and `course.progress` (when an active enrolment's % changes).
- **Completion:** through core `markEnrolmentCompleted`, which emits `enrolment.completed`.
- **Handles:**
  - `course.progress` (`content-progress.complete-at-100`)
  - `enrolment.completed` (`content-progress.record-completion`)
  - `enrolment.confirmed` (`content-progress.count-earlier-lessons`: a re-enrolment keeps lessons already done)
- **Jobs:** `content-progress.complete-finished` (hourly) and `content-progress.clean-uploads` (daily).
- **Slots and report:** as above.
- **Core API used:** `withTenant`, `audit`, `emit`, `assertCan`, `can`, `reach`, `courseTarget`, `getCourseLite`, `batchLite`, `studentEnrolments`, `enrolmentById`, `markEnrolmentCompleted`, `peopleLite`, `todayFor`, `universityLite`, `scheduledBatches`, `expandSessions`, `storage`, `systemActorFor`.

## New packages
- Dependencies: `sanitize-html`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `pdfjs-dist@4.10.38` (the legacy build, for older mobile browsers).
- Dev dependency: `@types/sanitize-html`.

## New environment variables
None. See `src/modules/content-progress/ENV.md`. With R2, the bucket needs CORS for `GET` with `Range` from the app's origin.

## Requests for other owners
1. **Core (menu):** add "Learning progress" (`/products/content`) under Products for roles holding `content.view_progress`. Today it is reached from the Curriculum tab's "Progress by batch" card.
2. **Core (contracts):** reserve an `adminBatchSections` key for content-progress (for example `progress`, order 100), so the batch page can list student progress directly.
3. **Core (storage):** add a presigned upload URL (`storage().signedUploadUrl(key, seconds, contentType)`). Browsers could then send large videos straight to R2 instead of through the app in parts. The parts are joined in memory, which is heavy for 250 MB on serverless.
4. **Integrator:**
   - Generate migrations for the new `content_lessons` columns (`ready`, `required`, `duration_minutes`, `drip_*`, `created_at`, `updated_at`) and the new tables `content_lesson_progress`, `content_course_progress` and `content_uploads`.
   - Existing rows need `ready` back-filled.
   - Check that `next build` bundles the pdf.js worker (`new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url)`); it works in `next dev`.

## Known issues
- **External video length:** for YouTube and Vimeo, the length comes from the player (floored at half the staff-set duration) and completion is computed from reports the browser makes. That is fine for progress tracking, but it isn't proof of watching.
- **Signed URLs:** video links last long enough to watch (up to 6 hours). Anyone holding a link can open it until it expires; that is how `storage()` signed URLs work.
- **Drip after a batch switch:** drip follows the student's current batch, so after a switch the unlock dates follow the new batch's start.
- **Completed courses that grow:** a completed enrolment stays completed if the course later gains required lessons. Its stored % may drop below 100, and the views show "Completed".
- **Seed files:** re-seeding leaves the previous run's files in `./.storage`, because the university id changes on every seed.
- **Not verified with a build:** `next build` was not run, as the environment asked.
