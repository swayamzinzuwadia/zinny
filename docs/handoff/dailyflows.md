# dailyflows handoff

Goal: cut the clicks on the jobs an institute does every day, the way quick course creation did for setup (see `quickstart.md`). Almost every daily job now starts and finishes on the dashboard.

## Built

- **Today's classes** (dashboard, `src/modules/live-classes/components/today-panel.tsx`): each class today with Take attendance, Mark everyone present (one click), Cancel class and Move class (defaults to tomorrow at the same time). A cancelled or moved class leaves the list, so its confirmation now comes back in the address (`?classDone=`) and shows at the top of the card. The "N students marked present" message stays after the list refreshes.
- **Register starts everyone as present** when nobody has a status yet, so you tap Absent or Late for the few who weren't there and save once.
- **Quick actions** (`src/components/quick-actions.tsx`), each one only offered to people allowed to do it:
  - Add a student: name, email, phone, batch, and "Paid now" to record the fee with a receipt, in one transaction. If the student already exists and the batch clashes with their timetable, the form shows the clash and offers "Add anyway" or "Don't add", keeping what was typed.
  - Record a fee payment: student, course (amount defaults to the course price), mode. Issues a paid invoice dated today.
  - Send an announcement to one or more batches (faculty, HODs, admins).
  - Add an extra class: starts from the batch's usual class time and tomorrow's date.
- **Needs you**: accept or decline join requests in place (department pre-picked); send overdue fee reminders in one click; go straight to new enquiries.
- **Students list**: tick students (or Select all), pick a batch, "Add N students to batch". A clash shows the warning with "Add anyway"; the ticks survive the warning.
- **CSV import** can put every student in the file into one batch, in the same transaction (a full batch saves nothing). Clashes are added anyway and counted in the result.

### One rule set for staff adding students (merge with the batch calendar work)

`claude/youthful-heisenberg-3eonoz` was merged in (week and month calendars, faculty timetable, staff "Add a student" on the batch page, clash warnings). The two ways of adding students it and this work had were folded into one:

- `addStudentToBatchTx` in `src/server/services/enrolment.ts` is the single rule: `batch.update` on the batch; live, running, not archived batch; seat limit (an accepted seat or hold in this batch already counts); a clash with the student's other batches comes back as a warning first and is added with `acknowledgeClash`; a request, accepted seat or unpaid hold anywhere in the course gives way (cancelled, its notification settled, hold's order expired); the student joins the batch's department; notified, audited (`enrolment.add_by_staff`) and `enrolment.confirmed` emitted.
- The batch page (`addStudentToBatch`), the dashboard's Add a student (`addStudentQuickly`), the Students list (`addStudentsToBatch`) and CSV import (`placeStudentsTx`) all go through it. The bulk paths add `user.admit` for the batch's department, the all-or-nothing seat check, and a clash pre-check across everyone ticked, so a warning saves nobody.
- Behaviour change: a request waiting in the batch is now cancelled and replaced by a new active place (it used to be flipped to active); a request in another batch of the course now gives way instead of being reported as "in another batch".

## Clicks, before and after

Counted from the dashboard after sign-in. "Clicks" are button, link, tick and dropdown choices; typing in a field is listed separately. **Before** is counted by reading the pages at commit `a0c09a0` (`git show a0c09a0:<path>`), not measured live. **After** was measured live with Playwright on the demo data (scripts in the session scratchpad, not committed).

| Task | Before (a0c09a0, counted from the old pages) | After (measured live) |
|---|---|---|
| Take today's attendance, everyone present | 3 clicks, 1 page change (Take attendance, Mark all present, Save) | **1 click, 0 page changes** (Mark everyone present) |
| Take today's attendance, one absent | 4 clicks, 1 page change | **3 clicks, 1 page change** (Take attendance, Absent, Save attendance) |
| Add a new student to a batch | Not possible for staff: Users, Students, Add a person (3 clicks, 1 page change, 3 fields), then the student had to sign in and enrol themselves | **3 clicks, 0 page changes**, 2 to 3 fields (Add a student, batch, Add student to batch) |
| Same, with the fee paid at the desk | The above, plus the whole fee flow below | **4 clicks, 0 page changes** (adds the Paid now tick; amount defaults to the course price) |
| Record a fee payment | About 7 clicks, 3 page changes, 3 or more fields (Finance, Invoices, Create invoice, find student, line item, Create invoice, Record payment) | **4 clicks, 0 page changes**, no typing needed (Record a fee payment, student, course, Record payment) |
| Cancel today's class | 2 clicks, 1 page change, 1 field (open the batch, type the date, Save and notify students) | **1 click and a confirm, 0 page changes** |
| Move today's class to tomorrow | 3 clicks, 1 page change, 4 fields (open the batch, choose Move, date, new date, from, to, Save) | **2 clicks, 0 page changes**, no typing (Move class, Move class and tell students) |
| Add an extra class | 3 clicks, 1 page change, 3 fields (open the batch from Seats by batch, choose Extra class, date, from, to, Save and notify students) | **3 clicks, 0 page changes** (Add an extra class, batch, Add extra class and tell students); day and times prefilled, change them if needed |
| Send an announcement to a batch | Not possible in Zinny | **3 clicks, 0 page changes**, 1 field (Send an announcement, tick batch, headline, Send announcement) |
| Accept a join request | 2 clicks, 1 page change (Join requests link, Accept into ticked departments) | **1 click, 0 page changes** |
| Remind overdue fees | Not possible in Zinny | **1 click, 0 page changes** (Send reminders) |
| Put many students into a batch | Not possible for staff (each student enrolled themselves) | **4 + N clicks, 1 page change** (Users, Students, batch, tick N or Select all, Add); measured 8 clicks for 3 students including "Add anyway" for one clash. Or a CSV import with the batch picked |

## Checked in the browser

- Admin (asha@demo.edu): every task above, including the clash warning and "Add anyway" on the dashboard and the Students list.
- HOD (hema@demo.edu): Add a student offers only Computer Science batches and no fee tick; extra class and announcement limited to her batches; batch page "Add a student" still works on the shared rule (refuses a student who already studies the course).
- Faculty (farah@demo.edu): only Send an announcement among quick actions, Today's classes with attendance but no cancel or move; announcement sent.
- No sideways scroll at 390, 820 and 1280 px on the dashboard (admin and faculty), Students list, Bulk import and the batch page. No page errors in the console.

Screenshots in `docs/handoff/dailyflows/`: dashboard as admin (1280 and 820), HOD and faculty, a moved class confirmation, the register starting as present, quick add student, the clash warning on the dashboard and on the Students list, and the bulk add result.

## Bugs found and fixed while clicking through

- After "Mark everyone present" the button and its message disappeared with the refresh, so nothing confirmed it. The form now stays mounted and keeps the message.
- Cancelling or moving a class removed the row and its message with it. The confirmation now comes back in the address and shows in Today's classes.
- Accepting or declining a join request removed the card and its message. It now redirects to the dashboard with the answer in Needs you.
- React clears a form's uncontrolled fields after every action, so after a clash warning "Add anyway" submitted an empty name and email (nothing happened). The quick add fields are now controlled; the Students list bar sends its form by hand so the ticks survive.
- "They get an email to set their password" was said for students who already had an account. It is now said only when an invitation was actually sent.
- The clash warning named only the batch ("Weekday morning"); it now names the course too.

## Not built (and why)

- Cancel or move for extra classes on the dashboard: the override service works on regular sessions; an extra class is changed from the batch's timetable.
- A clash prompt inside CSV import: a file can't stop to ask per student, so clashes are added and counted in the result message.
- `npm run check:ownership` doesn't know a "dailyflows" agent; this was done in the integrator role, so it was not run against a brief.

## Contracts used / provided

- Emits `enrolment.confirmed` for every staff placement (through `addStudentToBatchTx`), `user.invited` for new students. Notifications `enrolment.confirmed`, `batch.announcement`.
- New exports: `addStudentToBatchTx`, `studentClashesTx` (enrolment.ts); `placeStudentsTx(…, { acknowledgeClash })`, `addStudentsToBatch(…, { acknowledgeClash })`, `QuickStudentResult` now `{ status: "added" | "clash" }` (daily.ts); `ClashState`, `ClashFormAction`, `ClashPrompt` in `@/components/forms`.

## New packages

None.

## New environment variables

None.

## Requests for other owners

- `ActionForm` (and any `<form action>`) loses what was typed when the action returns an error, because React 19 resets uncontrolled fields after an action. Worth a shared fix (controlled fields or submitting by hand) across the app.

## Known issues

- The register's success message after a first save reads "Saved 3 changes." rather than "Attendance saved."
- The Students list table is wide at 1280 px with the tick column; it scrolls inside its card (the page doesn't scroll sideways).
- Test baseline unchanged: the same 4 failures as before this work (tests/core/core-api.test.ts export list, tests/core/focus-mode.test.ts, tests/reports-board/insights.test.ts, tests/zinny-team-panel/records.test.ts).
