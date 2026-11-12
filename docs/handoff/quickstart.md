# quickstart handoff

## Built
- `/[uni]/admin/products/courses/new`: one page for the course, its department (pick one or type a new name; "General" if left empty), the first batch (day chips, one time for all days or per-day times, dates default to next Monday plus 12 weeks, 30 seats), who teaches it (department staff, a new teacher inline, or "I'll teach it myself") and "Publish now". It saves in one transaction through `createCourseQuickly` (`src/server/services/quick-course.ts`). That function reuses `createDepartmentTx`, `addPersonTx`, `teachMyselfTx`, `createCourseTx`, `createBatchTx` and `updateCourseTx`, which were split out of the existing services; the public functions are unchanged. Errors name their section, and the form keeps what was typed.
- The course page shows a success notice and a "What's next" list (`courseNextSteps`). The batch form offers "I'll teach it myself" and "Add a new teacher" (`createBatchWithTeachers`) instead of the dead end.
- The dashboard has a "Get set up" checklist (`setupChecklist` in `src/server/services/setup.ts`, settings.manage only). It can be dismissed with a per-institute cookie.
- Empty states with a way forward on Courses, Departments, Teaching and Students.

## Not built (and why)
- "Sell a seat in this batch on the marketplace". The marketplace has no live-batch listing: its kinds are course, lecture and combo, and buying needs a recorded batch (`holdRecordedSeat`). Adding one needs a schema change (the kind check and the one-listing-per-course index) and a new buy flow. The page explains that recordings can be listed once lessons exist, and links there.

## Contracts used / provided
- No events or slots added. The checklist reads `site_pages` and `mkt_listings`, and next steps reads `content_lessons`, by table name under row-level security, only when those modules are installed.

## New packages
None.
## New environment variables
None.
## Requests for other owners
- Marketplace: a live-batch listing kind, if seats in live batches should be sold.
## Known issues
- A course in an institute with no GSTIN still defaults to 18% GST (the existing createCourse default). The GST field is hidden there.
