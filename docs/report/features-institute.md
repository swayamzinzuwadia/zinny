# Zinny feature reference: inside an institute, and the public side

This reference describes what the product does today, checked against the code and the module handoff notes. It covers one institute's private space (admin panel and learner app), the shared marketplace, the public pages, and sign-in. The Zinny team's own panel (`/platform`) is out of scope.

Conventions: times of day follow the institute's time zone. Money is in rupees, stored in paise. "Admin" means Institute Admin.

## 1. Institute roles and permissions

### 1.1 Roles

Each person holds one or more roles. A role grants actions. The scope of the assignment decides where those actions apply: the whole institute, one department, or one batch.

| Role | Allowed scope | Opens | Summary |
|---|---|---|---|
| Institute Admin | Whole institute | Admin panel | Everything inside the institute, including settings, privacy and roles. |
| Board / Owner | Whole institute | Admin panel | Read-only oversight of people, products, finance and insights. |
| Accounts & Fees | Whole institute | Admin panel | Finance only: sales, invoices, fees, refunds, reports. |
| HOD (Head of Department) | One department | Admin panel | Runs one department: courses, batches, faculty, switch approvals, tests, certificates, XP. |
| Permanent Faculty | Department (membership) or batch | Admin panel | Teaches assigned batches. Powers come only from batch assignments. |
| Visiting Faculty | Department or batch | Admin panel | Same as permanent faculty, with a mandatory end date. |
| Student | Whole institute | Learner app | Learns, takes tests, joins classes, pays and sees own records. |
| Alumni | Whole institute | Learner app | A graduated student. Keeps certificates and can still browse and enrol. |
| Parent | Whole institute | Learner app | Read-only weekly timetable of each linked child. |
| Custom role | Institute or department | Admin panel | Built by the admin from a list of abilities. |
| Individual Learner | Whole institute | Learner app | Added automatically when someone buys a live seat from the marketplace. |

Staff roles that open the admin panel: Institute Admin, Board / Owner, Accounts & Fees, HOD, both faculty roles, and custom roles. Students, alumni and parents use the learner app.

### 1.2 Permission matrix

"Own" means the actor's own department (HOD) or own batches (faculty). A dash means no access.

| Area | Admin | Board / Owner | Accounts & Fees | HOD | Faculty (permanent / visiting) |
|---|---|---|---|---|---|
| Dashboard | Full | View | View | Own department | Own batches |
| Courses and batches: view | All | All | - | Own | Own |
| Courses and batches: create, edit, delete | All | - | - | Own department | - |
| Assign faculty to batches | All | - | - | Own | - |
| Decide batch switch requests | All | - | - | Own | - |
| Accept or decline enrolment requests | All | - | - | Own | Own batches |
| Add students to a batch | All | - | - | Own | - |
| Curriculum and content | Edit | View progress | - | Edit | Edit own batches |
| Tests and question pool | Edit, grade | View results | - | Edit, grade | Edit, grade own batches |
| Assignments and polls | Edit, grade | View | - | Edit, grade | Edit, grade own batches |
| Live classes and attendance | Run, mark | View | - | Run, mark | Run, mark own batches |
| Mark course complete (offline) | Yes | - | - | Yes | No |
| Certificates: templates and issuing | Manage, issue | View | - | Manage, issue (department) | View |
| Users: view people | All | All | - | Department | Own students |
| Users: add people, change roles | All | - | - | Teachers in own department | - |
| Join requests (admit students) | All | - | - | Own department | - |
| Bulk import, graduate, link parents | Yes | - | - | - | - |
| Departments: manage | Yes | View | - | View own | - |
| Roles and permissions | Yes (Super Admin edits the Admin role) | - | - | - | - |
| Leaderboard: view | All | - | - | Own | Permanent only |
| XP rules, badges, challenges | All | - | - | Own department | - |
| Marketplace listings | All | - | - | Own department's courses | - |
| Finance: sales, invoices, reports | Full | View | Full | - (reports via Insights) | - |
| Refunds | Yes | - | Yes | - | - |
| Website | Yes | - | - | - | Own public profile |
| Insights | All | All | - | Own department | - |
| Settings, Seats, Documents | Yes | - | - | - | - |
| Privacy requests | Yes | - | - | - | - |
| Notification settings | Full | Own only | Own only | Own only | Own only |

Learner roles:

| Ability | Student | Alumni | Parent |
|---|---|---|---|
| Browse catalogue, enrol | Yes | Yes | - |
| Switch batch (request) | Yes | - | - |
| Lessons, progress, tests, certificates, invoices | Yes | Yes | - |
| Join live classes, submit assignments, vote in polls | Yes | - | - |
| XP, badges, leaderboard | Yes | - | - |
| Child's weekly timetable (read only) | - | - | Yes |

### 1.3 Rules that apply to every role

- Hiding a menu section is a convenience. Every action is also checked on the server.
- A faculty member's department-level role is only membership. They appear under Teaching and can be put on a batch. What they can do comes from batch assignments.
- Visiting faculty need an end date. Their access stops then.
- A custom role starts with only the basics (view the institute and departments, own profile). The admin ticks abilities on the Roles & permissions page, laid out as a grid with View, Add / Edit and Delete columns.
- Ticking an ability also ticks what it depends on. For example, "Grade tests" brings "See test results".
- Abilities are offered only at a reach where they work. A department-wide role cannot be given Finance, because finance works across the whole institute.
- Marketing and Community abilities exist but are hidden, because those sections are not built.

## 2. The institute admin panel

### 2.1 Menu and who sees what

The sidebar sections are Dashboard, Products, Marketplace, Users, Leaderboard, Finance, Website, Insights and Settings. Each person sees only the sections their role opens.

- The Marketplace section shows for anyone who edits courses, for the whole institute or their department.
- "My timetable" appears only for people who teach a batch.
- The Certificates page appears for people who issue certificates or set templates. Faculty see certificates on each course's Certificates tab.
- HODs have no Finance section. They reach Reports from Insights.

### 2.2 Dashboard and today board

The dashboard opens with a greeting and the day's board.

1. **Today's classes.** Each class today shows with its state (past, live, next, later). Staff with the right to teach see these actions:
   - **Take attendance** opens the register.
   - **Mark everyone present** records the whole roster in one click.
   - **Cancel class** and **Move class** (default: tomorrow at the same time) tell the students. These two are for people who can edit the batch. Faculty do not get them.
2. **Quick actions** appear only to people allowed to use them:
   - **Add a student**: name, email, phone, batch, and an optional "Paid now" tick that records the fee and a receipt.
   - **Record a fee payment**: student, course (amount defaults to the course price), payment mode.
   - **Send an announcement** to one or more batches.
   - **Add an extra class**: starts from the batch's usual time and tomorrow's date.
3. **Needs you** lists items to handle in place:
   - join requests (accept or decline, department pre-picked);
   - overdue fees (**Send reminders** in one click);
   - faculty access ending soon on a batch;
   - website enquiries and reviews;
   - refunds due or failed;
   - privacy requests;
   - tests and assignments waiting to be graded.
4. **Stat tiles:** enrolled students, open batches, collected this month (with GST), seats filled. Accounts sees money tiles instead of batch tiles.
5. **Batches filling up**, **Updates**, **This month**, and module cards such as attendance today, top learners, certificates issued and website.
6. **Get set up** checklist, for people with settings access, until done: course, batch, teacher, publish, students, website, marketplace. It can be hidden per browser.

### 2.3 Users

Pages under Users: Administration, Teaching, Students, Join requests, Departments, Invitations, Bulk import, Roles & permissions. A HOD sees Teaching, Students, Join requests, Departments and Invitations for their department only. Faculty find their students on batch pages.

#### Add a person

1. Open the group page (Administration, Teaching or Students) and use the add form.
2. Enter name, email, optional phone, role and, where needed, department.
3. For visiting faculty, set "Access ends" (required).
4. Save. If the person has no password yet, Zinny sends an invitation email.

#### Invitations

1. The invitation link is single use and lasts 7 days.
2. The person opens it, sees the institute, role and email, and sets a password.
3. They are signed in and sent to the admin panel or learner app.
4. On the Invitations page, the admin sees who is waiting, whose link expired, who never got one, and who joined in the last 30 days.
5. **Resend** issues a new link (once a minute per person). The old link stops. **Revoke** stops the link but keeps the role.

#### Bulk import (CSV)

1. Open Users, Bulk import.
2. Prepare a CSV with columns `name`, `email`, `role` (required) and `phone`, `department`, `access_ends` (optional).
3. Role values: student, permanent_faculty, visiting_faculty, hod, accounts_fees, board_owner, institute_admin.
4. Department takes the department code. It is required for HOD and faculty roles. Students may name one.
5. `access_ends` looks like `2027-03-31`. It is required for visiting faculty.
6. Optionally pick one batch to place every student in.
7. Run the check. Every row is validated, and nothing is saved unless every row is valid. Errors name the line.
8. Commit. Each new person is invited. In a chosen batch, a full batch saves nothing. Clashing students are added anyway and counted in the result.

#### Departments

- Admins create and edit departments. Each has a code, used in CSV import.
- The list shows each department's HOD, faculty count and course count.

#### Join requests and the joining code

1. Every institute has a 6-character joining code and link. A student enters it at sign-up or on `/join`.
2. The institute chooses the mode: **approval** (default) or **instant**.
3. With approval, the request waits. An admin, or the HOD of the department the student picked, accepts it and chooses the student's departments.
4. A student sees only the courses of their departments.
5. A joining poster is available for printing.

#### Parents and alumni

- **Link a parent:** on a student's row, enter the parent's name and email (phone optional). A parent account is created if needed and invited. The parent sees a read-only view.
- **Graduate a student:** moves a student to Alumni. Alumni keep certificates. Active enrolments in courses that belong to a program end.

#### Roles and permissions

Admins create custom roles and change what each role grants. Only a Super Admin can change the Institute Admin role.

### 2.4 Products: courses, batches and timetable

#### Courses

A course has a title, description, price, GST rate (0, 5, 12, 18 or 28 percent) and a department.

- The price is shown on the public website and marketplace. The institute's own students join for free.
- When GST is off for the institute, the GST field is replaced by "Not charged".
- A course can only be published when it has at least one open batch.
- **New course (quick flow):** one page creates the course, its department, its first batch (day chips, times, dates, 30 seats default), who teaches it, the batch incharge and an optional marketplace listing, all in one save.

#### Batches and seat limits

1. Open the course, Batches tab, and add a batch.
2. Enter a name, start and end dates, seat limit (at least 1), weekly slots (day and time), at least one faculty member, and an optional meeting link.
3. Tick "approval required" if faculty should accept each student first. The form ticks it by default.
4. Seats count students who are active, accepted, or holding an unexpired seat.
5. The seat limit cannot go below the seats already taken.
6. A batch can be open, closed or archived.

#### The clash check

A clash is two batches whose classes overlap on the same weekday and time, including moved and extra classes.

| Where | What happens |
|---|---|
| Student enrols | A warning names the clashing batch, with "Enrol anyway". |
| Student asks to switch batch | Same warning. |
| Staff adds a student | Warning first, then "Add anyway" or "Don't add". |
| Bulk add, CSV import | Students are added anyway. The result counts clashes. |
| Marketplace live seat | A note appears on the listing, cart and checkout. |
| After joining | Clashing classes show in gold on the timetable. |

#### The automatic timetable

1. The weekly slots of a batch become dated classes between its start and end dates.
2. Nothing dated is stored. Any change to dates, slots or exceptions shows at once.
3. Cancel a class, move it, or add an extra class from the batch page. Students are notified.
4. **Sections and plan:** a batch can have sections, each with its own faculty and a day-number plan (ranges like `1-5, 8, 10-12`) with topics and optional own times.
5. A **Batch incharge** can be chosen. The plan can be copied from another batch.
6. The Timetable tab offers week and month views, filters by section and faculty, a print layout and a CSV download.
7. Faculty see "My timetable" with only the classes they teach.

#### Batch switching with HOD approval

1. A student with an active seat opens My learning and asks to switch to another batch of the same course. The target must be open and have a free seat.
2. If the new batch clashes, the student confirms they still want it. They can add a reason.
3. The HOD of the target batch's department is notified.
4. The HOD (or an admin) approves or rejects, with an optional note.
5. On approval the same enrolment moves to the new batch. The old batch leaves the timetable. XP follows the student.
6. Approval fails if the batch filled in the meantime. The student is told.

#### Enrolment requests

1. If a batch requires approval, a student's enrol click creates a request and notifies the batch's approvers (HOD, admins, faculty on the batch, and the incharge).
2. The approver accepts or declines, with an optional note. Accepting needs a free seat and enrols the student at once.
3. A student can withdraw a request. Picking another batch of the same course replaces the earlier request.

### 2.5 Curriculum and content

1. Open the course, Curriculum tab. Add sections and lessons. Move them up or down, or to another section.
2. Choose a lesson type:
   - **Video:** upload MP4, WebM or MOV up to 250 MB, or paste a YouTube or Vimeo link.
   - **PDF:** upload up to 50 MB.
   - **Text:** rich text editor. HTML is cleaned when saved and shown.
   - **Link:** http or https only.
   - **Live:** no content. It shows the batch's next classes with a Join button.
3. Set each lesson as required or optional, its duration, and a drip rule: at enrolment, N days after batch start, or on a fixed date.
4. A lesson with no content is marked "Needs content". It is hidden from students and not counted in progress.
5. Course progress is completed required lessons divided by required lessons, rounded down. At 100% the course is completed and a certificate can issue.
6. **Learning progress** (Products) lists every course and batch in reach with students, not started, in progress, completed and average progress. A batch page lists each student.
7. **Mark complete** (people with the complete right) handles courses finished offline.

### 2.6 Tests and question pool

#### Question pool

- Each department has a pool. Admins also see an institute-wide pool.
- Question types: single choice, multiple choice (all or nothing), true/false, numeric (with tolerance) and short answer (graded by hand).
- Each question has marks, negative marks, difficulty, tags and an explanation.
- Search by text and filter by tag, type and difficulty.
- **CSV import** checks every row and saves nothing unless all are valid. Questions already in the pool are skipped.
- Removing a question archives it. Past attempts keep their own copy.
- Who writes: admins anywhere, HODs in their department, faculty in the pool of any department where they teach a batch. Faculty edit only their own questions.

#### Create and publish a test

1. Open Products, Tests, and create a test: choose type (quiz, mock test or test series), title and course.
2. Target the whole course (including future batches) or specific batches. Faculty can only target their own batches.
3. Add questions from the pool, reorder them, and add draw rules such as "8 random medium questions tagged SQL". Each student gets their own draw.
4. Set proctoring and timing (below), pass mark, and when answers are shown (never, after submit, after the test window closes).
5. Publish. Publishing checks the test is ready and notifies students of its batches.
6. Defaults: a quiz allows 3 attempts, 40 percent to pass. A mock test is 60 minutes, one attempt, shuffled, one question per page, full screen required, 3 tab switches.

#### Proctoring options

| Setting | Effect |
|---|---|
| Time limit | Server-side end time. Late answers are refused and the attempt is submitted. |
| Full screen required | The player asks for full screen. Leaving it is recorded, not penalised. |
| Tab-switch limit | Leaving the tab is recorded. Going over the limit submits the test. |
| Shuffle questions and options | Different order per student. |
| One question per page | Student moves through one at a time. |
| Attempt limit | Holds even if started in three tabs at once. |
| Open and close window | Entered in the institute's time zone. |

#### Results and grading

1. Objective questions are marked automatically.
2. Short answers go to the grading queue of whoever can grade on that student's batch.
3. The student is notified when a graded result is ready.
4. Results show attempts per student, best score, pass rate, percent correct per question, a batch filter, and each attempt with its proctoring log.
5. A test series is an ordered set of tests of one course, shown to learners as one item.

### 2.7 Assignments and polls

#### Set an assignment

1. Open Products, Assignments, New assignment. Pick the course (all batches, including future ones) or chosen batches.
2. Enter title, rich-text instructions and attachments.
3. Set due date and time, points (1 to 1000), the hand-in type (text, files or both), file count (1 to 10) and size limit (1 to 25 MB).
4. Choose whether late work is refused or accepted with a penalty of 0 to 100 percent.
5. Students are notified. A reminder goes the day before the due date to those who have not handed in.

#### Grade

1. Open the assignment. Each batch has a tab. Work to grade comes first, oldest first.
2. Enter marks (decimals allowed), feedback and optional returned files. **Save and grade next** moves on.
3. Final marks equal marks times (100 minus penalty) percent.
4. Students with no work can be graded too, for paper work or a zero.
5. Board members see status and marks but not the work itself.

Points are locked once anyone is graded. A batch with work cannot be dropped from an assignment.

#### Polls

1. Open the course, Polls tab. Create a single-choice poll with 2 to 10 options for a course or one batch.
2. Set open and close times. Optionally make it anonymous and show results to students after it closes.
3. Students vote once. Anonymous polls store no voter. Results reach students only after close, as totals.

### 2.8 Live classes and attendance

Zinny does not host video. Each batch or class has a meeting link. Zinny tracks the joining, attendance and recordings.

1. **Join window.** A student can join from 15 minutes before the start to the end. Joining after 10 minutes marks them late. Zinny then sends them to the class link.
2. **Start class** (faculty): available from one hour before. It opens the meeting in a new tab.
3. **Register** (`Take attendance`): the roster starts with automatic statuses. Everyone starts as present if nothing is recorded, so staff tap Absent or Late for the few. Add a note per student.
4. **Lock** the register. Students with no status become absent. HODs and admins can unlock.
5. Per-class meeting and recording links are edited on the register page.
6. **Batch attendance** shows each class with percent present and each student's percentage. The threshold defaults to 75 percent. An admin changes it in Settings.
7. **Weekly alerts** run daily and act once a week. Each student below the threshold is alerted, once they have 3 recorded classes. Each HOD gets a department summary.
8. A report, Attendance, filters by date, department, course and batch.

### 2.9 Certificates

#### Templates

1. Every institute starts with three A4 landscape designs: Classic (default), Modern and Minimal.
2. Admins open Products, Certificates, Templates. Edit the heading and wording, add up to two signatories (name, title, signature PNG or JPEG up to 500 KB), and use the live preview.
3. Each certificate shows institute name, logo and colour, student, course, completion date, a unique code, a QR code and optional "valid until".
4. **Make default**, add, archive and restore templates. Archiving is refused for the default and templates in use.
5. Issued certificates are frozen. Later template edits never change them.

#### Auto-issue and rules per course

1. Open the course, Certificates tab.
2. Choose the template, "issue automatically", validity in months (empty means never expires) and a reminder N days before expiry.
3. A course with no rule uses the default template, issues automatically, and never expires.
4. Nothing issues while the course's certificates are switched off.
5. When a course is completed, the certificate is issued, the student is notified, and the PDF is stored.

#### Manual issue, renewal and revoke

1. Manual issue needs a reason and a completion date.
2. The same action renews after expiry, or within 90 days before it (or the reminder window if longer). The new certificate links to the one it replaces.
3. Revoke needs a reason. The student is told it was revoked, not why.
4. A daily job sends one renewal reminder per certificate and marks expired ones.

#### Public verify page

- `/verify` and `/verify/[code]` need no sign-in.
- It shows student name, course, institute, issue date and status (valid, expired, revoked).
- It matches exact codes only, and accepts lower case, spaces and hyphens.
- Each visitor gets limited look-ups. Pages are marked noindex.

### 2.10 Leaderboards and XP

1. **XP rules** (Leaderboard, XP rules): choose a trigger, points (1 to 1000) and an optional daily cap (1 to 100 awards a day per student).
2. Triggers: finishing a lesson; passing a test, scoring at least N percent, or submitting a test; a live class marked present (or present or late); submitting an assignment, or on time; scoring N percent on an assignment; completing a course.
3. Scope: the whole institute (needs institute-wide rights) or one department. A HOD manages only their department's rules.
4. Rules are edited or switched off, never deleted. **Apply to past activity** replays earlier events once.
5. A re-taken test, re-completed lesson or regrade never pays twice.
6. **Badges:** award on XP, lessons, tests passed, classes attended, attendance streak in weeks, assignments on time, or courses completed. A badge is awarded once.
7. **Challenges:** a title, dates, a metric and a target for one batch or a course. Winners freeze after the end date.
8. **Leaderboards** rank by batch or course for this week, this month or all time. Ties share a rank. An admin chooses whether students see full names or first name and initial. Staff always see full names.
9. For learners under 18 without guardian consent, tracking can be switched off (see section 3.2).

### 2.11 Finance

#### Fees and sales

- Your own students join courses for free. Fees are recorded as invoices.
- **Record a fee payment** (dashboard, or Finance, Invoices): student, course or description, amount, mode (cash, UPI, bank transfer, cheque, card, other), reference and date. It issues a paid, numbered invoice dated today.
- **Overdue reminders** go to every student with an unpaid invoice past its due date, at most once a day per invoice.
- **Sales** (`Finance, Sales`) lists online orders. Filter by date, status (including "Partly refunded"), course and batch, or search by student, invoice number or payment id. Totals show gross, GST, refunds and net. Export to CSV.

#### Invoices

1. Open Finance, Invoices. The list combines order invoices and invoices the institute raises, with totals (billed, collected, outstanding, overdue).
2. **Create invoice:** pick a category (Course fees, Exam fees, Hostel, Library, Workshop and others), bill-to (search a student or type details), lines and a discount. GST follows the category rate and splits into CGST and SGST, or IGST by state.
3. On an invoice: record payment, mark unpaid, cancel with a reason, edit while unpaid, see history, download PDF.
4. **Categories:** create, rename, set default GST rate and SAC code, archive, restore.

#### Refunds

1. Open the order in Sales.
2. Enter the amount (full or partial) and a reason.
3. The refund goes through Razorpay. When processed, the student is notified.
4. Refunds can never exceed the amount paid, even when two people click at once.
5. Orders marked "refund due" (for example a double payment, or a batch that filled first) show on the dashboard.

#### GST invoices and the GST on/off setting

- A GST invoice (A4 PDF) shows seller name, address and GSTIN, invoice number and date, buyer, place of supply, course and batch, SAC code, taxable value, CGST and SGST (or IGST), total in figures and words.
- The first render is stored and never changes. Students download from the learner app. Staff download from Sales.
- Set the SAC code and footer in Finance, Sales, Invoice settings. Confirm the SAC code with your accountant.
- **Turn GST on or off:** open Finance, Sales, Invoice settings, then use "Charge GST on fees" (needs finance management).
- With GST off, new orders carry no GST, invoices are plain invoices with no GSTIN, and no price shows GST. Existing invoices never change. Turning it back on affects new orders only.
- A new institute answers the GST question at sign-up, with a GSTIN when it says yes.

#### Reports

- Reports (Finance, or Insights for HODs) offers Enrolments and Transactions, with date ranges (7, 30, 90 days, this or last month, financial years, custom), and CSV export. A HOD sees their department only. Accounts sees Transactions only.

### 2.12 Marketplace listings

Selling needs the right to edit the course.

1. Open Marketplace, Listings (or the course's Marketplace tab).
2. **List a course:** the course needs at least one ready video lesson. Set title, description, price (at least ₹1) and an optional compare-at price shown struck through.
3. **List a lecture:** one video lesson becomes its own one-lesson product.
4. **List a live batch:** sells a seat in a real batch. It stops being offered by itself when the batch has ended, closed, needs approval, is full (shown as "Batch full"), or has started without late joining. The page says why.
5. **Combos:** 2 to 10 courses bundled, each with ready recorded lessons.
6. **Discount codes:** percentage (max 90) or fixed amount, for one listing or everything (admin only). Optional start and end dates and a use limit. A code cannot take the price below ₹1.
7. Pause, relist or remove any listing. The page shows live listings, buyers and earnings.
8. The listed price is before GST. GST is added at checkout, unless the institute has GST off.

### 2.13 Website builder

See also section 5.1 for the public result.

1. **Manage profile:** tagline, about, founded year, address, city, map link, phone, WhatsApp, enquiry email, six social links, logo, cover image and site colour (it must reach 4.5:1 contrast on cream).
2. **Builder:** the home page is 12 ordered sections: hero, about, courses, faculty, testimonials, reviews, gallery, videos, blog highlights, team, enquiry form and contact. Move, show, hide or edit each.
3. Changes save to a draft. Open the draft preview. **Publish** replaces the live page, or **Discard** the changes.
4. **Website sections:** testimonials and team (ordered, shown or hidden); reviews (approve, hide, delete); gallery (several photos at once, with captions); videos (YouTube links); blog (rich text editor, slug, cover, excerpt, author, draft or published, preview); enquiries inbox.
5. **Faculty profiles:** staff edit their own profile (photo, headline, bio, subjects) and send it for approval. Admins approve, send it back with a note, or hide it. The approved version stays live while changes wait.
6. Images are re-encoded to WebP. SVG is refused.

### 2.14 Insights and reports

Insights (Admin, Board, HOD for own department) shows:

- stats, then enrolments per week (12 weeks);
- completion by course;
- revenue per month and per course, before GST, excluding refunded orders (people with finance view only);
- faculty load (last, this and next week);
- batch fill.

Module reports (Test scores, Attendance, Course and batch progress, Website enquiries) appear on the Reports page, filtered to what the viewer may see.

### 2.15 Notifications

Settings, Notifications (admins) has four tabs:

1. **Notifications:** for each kind of message, set the channel (on, optional or off), edit the text, add SMS or WhatsApp template ids, preview and send a test. **Restore defaults** resets.
2. **Delivery log:** filters, and **Send again** for failed messages.
3. **Setup:** provider status and the reply-to address.
4. **My notifications:** each staff member's own switches. Staff other than admins see only this tab.

How delivery works:

| Channel | Provider and rules |
|---|---|
| Email | Resend. Sender shows the institute name, with a reply-to address and one-click unsubscribe. |
| SMS | MSG91 with DLT templates. A text with no template id fails and names the kind. |
| WhatsApp | MSG91 templates. |
| Quiet hours | Texts are held between 9 pm and 8 am, institute time. |
| Security messages | Sign-in codes, resets, invites. They ignore quiet hours and opt-outs and are tried once. |
| Retries | After 1 minute, 5 minutes, 30 minutes, 2 hours, then marked failed. |

Learners set their own switches on their notification settings page, within what the admin allows. A signed unsubscribe link works without signing in. Where no provider keys are set, messages print to the server log.

### 2.16 Settings

The Settings page links to: Notifications, Joining code, Sign-in options (phone sign-in on or off), Leaderboard names, Invoice settings, Institute profile, Roles & permissions, plus the attendance threshold. The menu also lists Seats, Privacy and Documents.

#### Seats

1. Open Settings, Seats. See seats in use against the student and staff caps of your licence.
2. One pack adds 25 students or 5 staff by default. The price is ₹2,500 per student pack and ₹3,000 per staff pack for a year, before GST. A plan can change these.
3. Enter the number of packs. The price is pro-rated for the days left in the licence term, with CGST and SGST or IGST shown.
4. Click **Buy N packs for ₹X**. If the price changed since the page loaded, nothing is bought and the new price shows.
5. The Zinny invoice appears in the list. **Pay** works with the test gateway. Otherwise pay by bank transfer.
6. Packs renew with the licence. Buying needs settings access. Caps trigger a warning to the Zinny team at 90 percent. The code does not block adding people at the cap.

#### Documents

- Open Settings, Documents. Upload, replace, open or remove the documents of your institute: PAN card (required, can be replaced but not removed), partnership deed, MOA, AOA, GST certificate, licence or registration.
- Files are PDF, JPG or PNG up to 10 MB. Old versions are kept. The Zinny team reviews each file and approves or rejects it with a note.

#### Privacy

Needs the privacy right. Tabs:

1. **Requests:** access, correction, erasure, nominee and grievance requests from learners, each with a due date (15 days for correction and nominee, 30 for erasure and grievance).
2. **Consents:** see and manage consent records.
3. **Retention:** set the inactivity period (default 3 years, range 6 to 120 months) and the action, flag or anonymise. Learners are told by notification and email. Anonymising happens at least 48 hours after flagging. Admins can keep or anonymise a flagged account.
4. **Data processing:** Zinny acts as processor for your learners' data.

Erasure anonymises name, email, phone and password, deletes the KYC row, withdraws consents, ends roles and signs the person out. GST invoices are kept for 8 years, and the consent and request log is kept.

### 2.17 Trial banner, licence banner and frozen state

- **Trial banner:** during the free 3-day trial, people with settings access see a gold bar, "N days left in your free trial", with **Choose a plan**.
- **Frozen state:** on the end date, if no plan covers today, the institute freezes. Admins can open only Choose a plan and Documents. Everyone else sees a frozen notice. Nothing is deleted. The Zinny team can extend a trial by 1 to 60 days.
- **Choose a plan:** lists plans with prices before and with GST. It needs a usable PAN card. Payment works only with the test gateway today. With real Razorpay it asks the institute to contact Zinny.
- **Licence banner:** when the Zinny licence has 30 days or fewer left, or has ended, admins see a bar. It turns urgent (solid gold) at 7 days or fewer. **Renew licence** opens Settings. **Remind me tomorrow** hides it for the day.
- A suspended institute is closed to its own people.

### 2.18 The collapsible sidebar

1. Use the toggle at the top of the sidebar to collapse it to an icon rail.
2. In the rail, hover or focus an icon to see its name.
3. The choice is saved in a cookie, so the page loads at the right width.
4. With no saved choice, the sidebar is open on wide screens and a rail on tablets (768 to 1279 px).
5. On phones, the menu opens from a "Menu" bar at the top.

## 3. The student and learner app

The learner app is mobile first and is checked at 390 px. Parents get a one-page, read-only version.

### 3.1 Navigation

Primary tabs: Today, Timetable, Courses, My learning. More: Assignments, Tests, Polls, Leaderboard, Certificates and Invoices. The account menu holds the profile, privacy and notification settings. Marketplace-only learners see Timetable (when they hold a live seat), My library and Marketplace.

### 3.2 Sign-up, age and guardian consent

A student account can be made three ways: from the institute's joining code, from an institute link, or as a marketplace account.

1. Open `/signup` and choose **Sign up as student**.
2. Enter name, email and password. A mobile number is optional when joining an institute. If given, Zinny sends a code to confirm it.
3. Enter a joining code if you have one. Pick your department if asked.
4. Answer "Are you 18 or older?". A date of birth is optional. The answer or the date must show an age.
5. Tick the two required consents (account use, and learning records). The third, news, is optional.
6. Click **Create my account**. Network limits apply.
7. With the joining code, you join at once or wait for acceptance, per the institute's mode.

**If under 18:**

1. Enter the parent or guardian's name and email or mobile.
2. Zinny sends them a link valid for 7 days.
3. The guardian reads what is processed and confirms. This records their consent.
4. Until they confirm, optional purposes are refused, tracking and XP are off, and the learner's home shows a gold card saying the app is waiting for the parent.

### 3.3 KYC

KYC is optional. A "Complete your KYC" card shows on the home page until done.

1. Open `Learn, KYC`.
2. Enter your PAN in the form `AAAAA9999A`.
3. Enter only the **last 4 digits** of your Aadhaar. A full number is refused and never stored.
4. Tick the consent box.
5. Save. The PAN is encrypted and shown only masked, as `XXXXX1234F`.

### 3.4 Joining a batch

1. Open Courses. The catalogue shows courses of your departments.
2. Pick a batch. Each card shows days, times, dates, faculty and seats left.
3. If the batch clashes with another course, a warning names it, with **Enrol anyway**.
4. A full or closed batch cannot be joined.
5. For an open batch, you are enrolled at once and it joins your timetable.
6. For an approval batch, a request is sent and you are notified of the answer. **Withdraw** cancels it.
7. Existing members can later ask to switch batch (section 2.4).
8. Already have a Zinny account? Use `/join` and enter the institute's code.

### 3.5 Home, timetable, lessons and progress

- **Today:** the day's board with the live or next class and a Join button, a week strip, learning cards (continue learning, XP, certificate, KYC, guardian consent), and recent updates.
- **Timetable:** week and month views, day number, section, faculty and topic. Clashes show in gold.
- **My learning:** each course with progress, the batch, the incharge and the next class.
- **Lessons:**
  1. Open a lesson. Video plays with resume. PDFs render page by page. Text and links open in the page.
  2. A video completes at 90 percent watched. Other types use **Mark complete**.
  3. Locked lessons show when they open.
  4. Next and previous buttons and the course outline show progress.

### 3.6 Taking tests

1. Open Tests. See available, upcoming and completed tests.
2. Open a test to read the rules and see past attempts.
3. Click start. The test takes the whole screen. The timer counts down to the server's end time.
4. Every answer saves as you go. A reload resumes the attempt.
5. If full screen is required and you leave it, the screen asks you to go back. This is recorded.
6. If a tab-switch limit is set, leaving the tab is counted. Going over submits the test.
7. When time ends, the attempt is submitted, even if you were away.
8. The result follows the setting: shown after submit, after the window closes, or never. Short answers wait for a teacher.

### 3.7 Assignments, polls and live classes

**Assignments:** the list groups work as To do, Handed in, Graded and Missed.

1. Open an assignment. See due date (gold within a day), instructions and teacher files.
2. Hand in text, files or both. You can hand in again until the due date. Every version is kept.
3. After the due date, late work is refused, or allowed once with a penalty.
4. See marks, feedback and returned files after grading.

**Polls:** vote once. Results show after the poll closes.

**Join a live class:**

1. A "Join next" card shows when a class is on or starts within 2 hours.
2. The Join button turns on 15 minutes before the start.
3. Click **Join**. You are marked present, or late after 10 minutes, and sent to the class link.
4. Too early, ended, cancelled and moved classes show a page saying why, with the recording when there is one.
5. Your course page shows attendance percent, upcoming classes and past classes with your status.

### 3.8 Certificates, XP and badges

- **Certificates:** each certificate is drawn on screen with status and dates. Download the PDF or share the verify link.
- **XP and leaderboard:** total XP, this week, this month, rank in each batch, challenges with progress, the badge shelf, and recent XP. Names follow the institute's setting.
- **Badges:** locked badges are shown in outline. A gold ring marks one earned in the last 7 days.

### 3.9 Invoices

Open Invoices. See order invoices and invoices raised by the institute, with status and due date. Download each as a PDF. A notification arrives when one is issued or cancelled.

### 3.10 Privacy rights

Reach them from the profile, the privacy notice or the learner home card. The institute's records are under the profile. Zinny's own records (marketplace) are at `/privacy/my`.

1. **Consents:** see each purpose (account, service, KYC, news, analytics, guardian). Withdraw news or analytics with one tap. Account and service end only through erasure.
2. **Download:** get your data as JSON (profile, roles, enrolments, orders and invoices, KYC with PAN masked, consents, requests).
3. **Correction:** describe the fix. Due in 15 days.
4. **Erasure:** ask for it. Due in 30 days. Invoices and the consent log are kept, and the reply says so.
5. **Nominee and complaint:** record a nominee, or file a grievance.

### 3.11 Notifications

The Updates page lists in-app notifications. Switches per kind and channel are under Notification settings, within what the admin allows. Security messages cannot be switched off.

### 3.12 Parents

A parent signs in, sees each linked child's week, read only. A parent with no linked child sees a prompt to ask the institute.

## 4. The marketplace

The marketplace is shared across institutes at `/marketplace`. It sells what institutes list. Zinny does not generate content or recommend by AI in the product today. The landing page mentions an AI-enabled marketplace, but no AI feature exists in the code.

### 4.1 Who can browse and buy

- Anyone can browse.
- Buying is open to students, alumni, individual learners, and people with a free Zinny marketplace account.
- Staff accounts cannot buy.

### 4.2 Browsing

- **Recorded** (`/marketplace/recorded`): courses, lectures and combos. Filter by type and offers. Sort by new, price, deals.
- **Live** (`/marketplace/live`): seats in live batches, "yet to start" or "running now". Sort by start or price.
- **Institutes** (`/marketplace/institutes`): every active institute, sellers first. An institute page has Recorded, Live batches and Upcoming tabs.
- Search on the home looks in both halves.
- A listing page shows price, compare-at price and percent saved. For a live seat it shows dates, timings, faculty, classes left and seats left.

### 4.3 Recordings versus live seats

| | Recorded | Live batch seat |
|---|---|---|
| What you get | Lessons to watch any time | A real seat in a batch with classes |
| Seat limit | None | The batch's limit. Seats are held for 10 minutes. |
| Clash with other batches | Not possible | Checked and warned |
| Joining classes | Not applicable | Join route works for the buyer |
| Where it appears | My library | My library, Timetable and live join |
| A buyer who owns one can buy the other? | No: one live enrolment per course | No |

### 4.4 Buy, step by step

1. Open a listing. Click **Add to cart** or **Buy now**.
2. Open the cart. Items from different institutes can be paid together. Items you already own drop out.
3. Optionally enter a discount code. It applies to items it fits. If it fits nothing, you are told.
4. Click checkout. Each item becomes its own held order. A live seat is held for 10 minutes.
5. Review the totals: before GST, GST and total.
6. Pay with UPI, card or netbanking.
7. On payment, access arrives in My library. Each institute issues its own GST invoice, found in My library.
8. If a second payment arrives for something you already own, it is marked refund due.

### 4.5 GST at checkout

- Listed prices are before GST.
- GST is added at checkout using the course's rate, split CGST and SGST or IGST by state.
- If the selling institute has GST off, no GST is added and no GSTIN shows.
- Each invoice is issued in the selling institute's name.

### 4.6 What the seller institute sees

- Listings page: live and paused counts, buyers, total earned and earned this month. Earnings count the price before GST of paid orders.
- A live-batch listing shows seats sold through the marketplace separately from the institute's own students.
- Orders also show in Finance, Sales, with refunds, invoices and CSV export.
- A buyer is added to the institute as "Individual Learner". The institute sees them as a person with a role there.
- Discount code uses are counted.
- A full refund ends the buyer's marketplace seat.

## 5. Each institute's public website, and the Zinny landing page

### 5.1 Institute public website

The site lives at `/site/[institute]`. It is static and refreshes when the institute publishes.

**Pages:** home, blog and blog posts, course pages, faculty profiles, a sitemap and robots file.

**Home sections (up to 12):** hero, about, courses, faculty, testimonials, reviews, gallery, videos, blog highlights, team, enquiry form, contact.

**Course page:** lists open batches with timings and seats left. **Enrol** goes into the learner app.

#### Enquiries

1. A visitor fills the enquiry form (name, email, optional phone, message, optional course).
2. A hidden honeypot field and rate limits (5 an hour per sender, 200 per site) stop bots.
3. Staff with website rights are notified.
4. In Website, Sections, Enquiries, staff set status (new, contacted, closed), assign someone and add notes.

#### Reviews

1. A visitor sends a name, email, rating of 1 to 5 stars and a review of 20 to 1,500 characters.
2. The review waits. It does not appear on the site.
3. Staff approve, hide or delete it. Only approved reviews show. Reviewer emails never show.

### 5.2 The Zinny landing page

Purpose: it tells institutes and learners what Zinny is and gives each a way in. It shows at `/` to signed-out visitors.

| Section | Content |
|---|---|
| Nav | Who uses Zinny, Marketplace, Sign in, Sign up |
| Hero | "Run your institute. Sell what it teaches." with two doors: I run an institute, I want to learn |
| Film | A scroll story: scattered tools (WhatsApp, spreadsheets, paper) become one place |
| Loop | Teach, record, list, sell, get paid; a calculator with sliders for courses, price and monthly buyers |
| Who uses Zinny | Six personas: coaching institutes, universities and colleges, teachers, students, working professionals, parents |
| Learners | Live shelf of recordings on sale, with Browse and Create account buttons |
| India | UPI, cards and netbanking; GST invoices if charged; walled-off data; verifiable certificates; every role; built for mobiles |
| Finale | Two doors again |
| Footer | Marketplace, Book a demo, Verify a certificate, Sign in, Sign up, Privacy notice, Grievance officer |

Related public pages:

- **Sign up as institute** (`/signup/institute`, also `/book-a-demo`): a four-step wizard. Step 1 institute details and URL slug. Step 2 your account. Step 3 GST, yes or no, with GSTIN. Step 4 documents (PAN required) and consents. It starts a free 3-day trial.
- **Book a demo**: a "Request a call" form.
- **Privacy notice** at `/privacy` (Hindi essentials at `?lang=hi`).

## 6. Accounts and security

### 6.1 Sign in

1. Open `/login`. Enter email and password. If you belong to several institutes, you choose one.
2. After 5 wrong passwords, the email pauses for 15 minutes, even with the right password. Repeat locks double, up to 4 hours.
3. 50 failures from one network in 15 minutes pause that network.
4. Every sign-in creates a new session and ends the browser's previous one.
5. A "next" link stays on this site.

### 6.2 Password reset

1. Open `/reset` and enter your email. The answer is always the same, whether the account exists or not.
2. Open the emailed link. It is single use and lasts 30 minutes.
3. Set a new password.
4. All your sessions end, and you are signed in here. A "password changed" email is sent.
5. Limit: 3 emails an hour per address.

### 6.3 Phone OTP

Available when the institute has turned on phone sign-in (Settings, Sign-in options).

1. On `/login`, open the **Mobile number** tab.
2. Enter your number. A 6-digit code is sent by SMS.
3. Enter it within 5 minutes. You have 5 tries. Resend after 30 seconds, up to 5 codes.
4. 10 wrong codes in an hour pause the number for 30 minutes.
5. If a family shares a phone, you choose which account signs in.
6. Unknown numbers look the same on screen, but no SMS is sent.

### 6.4 Sessions and profile

Open Your profile (`/[institute]/profile`).

- Change your name.
- Change your mobile number. It saves only after a code sent to the new number is entered.
- Upload a photo. It is cropped to 512 px and stripped of location data.
- Change your password. It needs the current one and signs out other devices.
- See sessions with device, how you signed in, when, last active and IP. **Sign out** per device or **Sign out everywhere**.
- Sessions expire after 14 days of no use, or 30 days at most. Cookies are httpOnly.

### 6.5 Cookie notice

- A banner shows on public pages only. Essential cookies only by default, with an analytics switch.
- The choice is remembered for 180 days and can be reopened from the privacy notice.

## 7. What is not built

| Item | Status |
|---|---|
| Single sign-on, staff two-factor authentication, parent self-registration | Not built |
| Marketing and Community sections | Roles carry the access, no menu entry |
| Real Razorpay for institute plan purchases | Test gateway only. Contact Zinny to pay. |
| Seat cap enforcement | Warnings only |
| Emails for rejected documents and trial end | No notification kinds yet |
| Consent manager integration, Rule 11 guardians | Not built |
| Full Hindi privacy notice | Essentials only |
