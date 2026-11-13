# calendar handoff

Audit and fixes for the dynamic batch calendar, joining by every path, and timetable clash warnings.

## Built

### What was already correct (verified in the browser and in tests)
- The batch's dated timetable (Timetable tab): every class day from start to end date, weekly slots, cancelled / moved / extra classes, day numbers from the day-number plan, each section with its own faculty and topic, the incharge in the printed heading, gold for today or the next class. Nothing is stored, so changes to dates, timings or overrides shift it at once.
- The student's timetable and the learner home are computed live from active enrolments (`studentTimetable`), so any path that makes an enrolment active shows up on the next page load. Catalogue self-enrol, accepting a request, marketplace purchase (on payment) and an approved batch switch all already set the enrolment active; a switch moves the same enrolment, so the old batch leaves the timetable.
- The catalogue picker and switch picker already warned about clashes before joining and let the student carry on ("Enrol anyway", "Request anyway").

### What was broken or missing, and is now fixed
- **Batch overview calendar was a fixed "This week" strip.** It could not move to another week, had no month view, and showed only the course name with a truncated section and no faculty. Now `batch-calendar.tsx`: week and month views, Previous / This week (month) / Next, Show week / Show month, one row per day with time, day number, section, section faculty (or batch faculty when nothing is planned), topic, extra/moved labels and cancelled days. The month grid links each day to its week; at 390 px the month turns into a list of class days. No sideways scroll at 390 px or desktop.
- **Staff had no way to add a student to a batch.** New `addStudentToBatch` / `studentsToAdd` in `enrolment.ts` (permission `batch.update`, inside `withTenant`, audited as `enrolment.add_by_staff`, emits `enrolment.confirmed`, notifies the student, respects the seat limit, replaces a pending request/accepted seat/unpaid hold in the same course). "Add a student" card on the batch page, with an email field that suggests the institute's students not yet in the course.
- **findClashes ignored one-off classes.** It now also compares moved and extra classes (of either batch) with the other batch's concrete classes on that date, only expanding those dates and capping at `MAX_ONE_OFF_CLASHES` (6) per pair. Weekly wording is unchanged ("Mon 9 am–11 am"); one-off clashes read "Sat, 9 Nov, 10 am–11 am".
- **No clash warning on the marketplace.** `liveClashes(userId, batchIds, { together })` in the marketplace service reads (system connection, reads only) the buyer's active and held seats at every institute, since a buyer is one Zinny user everywhere. The live listing page, the cart (also seats in the cart that clash with each other) and the cart checkout show "Timetable clash. This batch clashes with Python Basics – Weekend, Demo Institute on Sun, 10 am–1 pm. You can still buy it." Batches at institutes in different time zones are not compared.
- **No warning for staff.** Adding a student whose batches clash returns the warning first ("Kabir Mehta's place in this batch clashes with Data Analytics – Weekday morning on Mon to Fri, 9 am–11 am.") with "Add anyway" / "Don't add". Enrolment requests waiting for acceptance now carry a clash warning too.
- **Clashing classes were not visible after joining.** `markClashes` marks sessions on the student's timetable that overlap another batch's class; the week view, month view, the timetable's upcoming list and the home day agenda show them in gold ("Clashes with Machine Learning Foundations"), and the timetable page lists the clashing times at the top with the way out (ask to switch batch).
- **No faculty timetable page.** `/[uni]/admin/products/timetable` ("My timetable" under Products, shown only to people who are faculty on a batch): week and month views, "Only the classes I teach", and a coming-up list linking to each batch's timetable. `facultyTimetable` now also checks `batch.view` on each batch.
- Learner timetable gained a month view (shared `src/components/month-view.tsx`).
- Clash wording moved to `src/server/lib/clashes.ts` (`clashLines`, `clashSentence`); `src/app/[uni]/learn/clash-lines.ts` re-exports it. The picker's card shows the full clash line instead of "Overlaps X".

### Tests (`tests/calendar/`)
- `clashes.test.ts`: weekly and one-off clashes, the cap, clashes outside the batches' overlap, `markClashes`, wording.
- `joining.test.ts`: each joining path (catalogue, request then accept, staff add, marketplace purchase, switch) puts the batch on `studentTimetable` and in the roster and seat count; a switch removes the old batch; clash warnings for catalogue, extra classes, staff add, requests and switch requests; who may add students (allow: admin, HOD; deny: faculty, student, another institute's admin); seat limit and non-student emails; marketplace clashes across institutes, time zones and within a cart; faculty timetable allow/deny; menu entry.

Results: `npm run typecheck` and `npm run lint` pass. `npm test`: 1559 passed, 4 failed, exactly the 4 pre-existing failures (core-api export list, focus-mode, reports-board insights, zinny-team-panel records). `check:ownership` not applicable (integrator task).

Screenshots in `docs/handoff/calendar/`: admin batch week/month (desktop and 390 px), admin add-student clash, learner picker clash (390), learner timetable week/month with clashes (desktop and 390), learner home (390), marketplace live listing, cart and checkout with a clash (desktop and 390), faculty timetable (desktop, month, 390).

## Not built (and why)
- Clashes across institutes in different time zones are skipped rather than converted: class times are stored as wall-clock times in each institute's zone and comparing them needs date-aware zone conversion.
- The institute checkout page for single orders (`/[uni]/learn/checkout/[orderId]`) has no clash note: live seats sold on the marketplace go through the cart checkout, and institute courses are free for their own students.
- HODs deciding a batch switch don't see a clash warning (the student saw it when asking).

## Contracts used / provided
- Emits `enrolment.confirmed` when staff add a student (same payload as self-enrol).
- Core API: `findClashes` and type `Clash` added to `@/server/core` (the core-api export-list test was already failing and stays failing).
- New menu item `/products/timetable`.

## New packages
None.

## New environment variables
None.

## Requests for other owners
- The click-reduction agent may want the "Add a student" form elsewhere (for example on Users, Students); the service `addStudentToBatch` is ready for it.

## Known issues
- The demo database used for the screenshots has extra enrolments (Riya in Machine Learning, Aditi and Kabir added to it) and the Machine Learning batch's seat limit raised to 12; run `npm run db:reset && npm run db:seed` for a clean demo.
