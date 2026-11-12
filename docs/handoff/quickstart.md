# quickstart handoff

## Built
- `/[uni]/admin/products/courses/new`: one page covers:
  - the course, with GST shown only when `university.gstEnabled` is on;
  - its department: pick one, or type a new name ("General" if left empty);
  - the first batch: day chips, one time for all days or a time per day, dates defaulting to next Monday plus 12 weeks, 30 seats;
  - who teaches it: department staff, a new teacher added inline, or "I'll teach it myself";
  - the batch incharge, which defaults to the teacher;
  - "Publish now", and "Also sell a seat in this batch on the marketplace", priced from the course price.
- The page saves everything in one transaction through `createCourseQuickly` (`src/server/services/quick-course.ts`). It reuses `createDepartmentTx`, `addPersonTx`, `teachMyselfTx`, `createCourseTx`, `createBatchTx`, `updateCourseTx`, `setInchargeTx` (batch-plan) and `createBatchListingTx` (marketplace). These are transaction-level versions split out of the existing services; the public functions are unchanged. Errors name their section, and the form keeps what was typed.
- The course page shows a success notice and a "What's next" list (`courseNextSteps`). Its batch form also offers "I'll teach it myself" and "Add a new teacher" (`createBatchWithTeachers`).
- The dashboard has a "Get set up" checklist (`setupChecklist` in `src/server/services/setup.ts`, settings.manage only). Live batch listings count for its marketplace step. It can be dismissed with a per-institute cookie.
- Empty states with a way forward on Courses, Departments, Teaching and Students.

## Not built (and why)
Nothing from the brief.

## Contracts used / provided
- No events or slots added.
- The quick flow calls `createBatchListingTx` in the marketplace module and `setInchargeTx` in batch-plan.
- The checklist reads `site_pages` and `mkt_listings`, and next steps reads `content_lessons`, by table name under row-level security, only when those modules are installed.

## New packages
None.
## New environment variables
None.
## Requests for other owners
None.
## Known issues
- When GST is off, a course is still saved with the 18% rate, the same as the branch's own course form. Orders then charge no GST (`orderGst`).
