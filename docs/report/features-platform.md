# Zinny platform features: the Zinny team and the institute lifecycle

This reference describes what the code does today. It was checked against the services, not only the handoff notes. Where a handoff note was out of date, the code wins and this is said. Anything proposed but not built is marked **Proposed**.

Dates are India dates (Asia/Kolkata). Money is stored in paise and shown in rupees. All prices are before GST unless stated.

## 1. Roles on the Zinny team

The Zinny team works in the panel at `/platform`. Team members never act inside an institute directly. They use support mode (section 2.10) to do that.

### 1.1 The roles

| Role | Purpose | Built-in permissions |
|---|---|---|
| Super Admin | Runs Zinny and the team itself | All eight platform permissions |
| Account Manager | Owns the institute relationship | Manage institutes, manage licences, view analytics |
| Finance Admin | Owns billing | Manage Zinny invoices, manage licences |
| Support Agent | Helps institutes | Support mode, view analytics |
| Content QA | Reviews courses | Review course content |
| Custom team role | Whatever a Super Admin ticks | Chosen per role at `/platform/roles` |

Partnerships is a legacy role. The Partners pages were removed, so it opens nothing, and it cannot be assigned to new people.

The eight platform permissions are: manage institutes, support mode, manage licences, content review, partners (hidden, opens nothing), manage Zinny invoices, view analytics, and "Edit seat packs and user caps". The last one needs "manage licences" with it.

### 1.2 Permission matrix

"Yes" means the page opens and the person can act. "Read" means view only. The sidebar hides pages a person cannot open, and each service checks again.

| Area | Super Admin | Account Manager | Finance Admin | Support Agent | Content QA |
|---|---|---|---|---|---|
| Overview (shows only the parts they may see) | Yes | Yes | Yes | Yes | Yes |
| Institutes: list, detail, create, edit, search | Yes | Yes | No | No | No |
| Suspend and reactivate an institute | Yes | Yes | No | No | No |
| Sign-ups: review documents, extend trials | Yes | Yes | No | No | No |
| Plans and prices | Yes | Yes | Yes | No | No |
| Licences, seat packs on a licence | Yes | Yes | Yes | No | No |
| Set a licence's caps by hand, edit pack prices | Yes | No | No | No | No |
| Invoices: create, revise, mark paid | Yes | No | Yes | No | No |
| Billing settings (payment terms, reminders) | Yes | No | Yes | No | No |
| Run billing now | Yes | No | No | No | No |
| Users (all accounts) | Yes | No | No | No | No |
| Sign in as a person, view as a student, set a password | Yes | No | No | No | No |
| Support mode and activity log | Yes | No | No | Yes | No |
| Content review: review, flag, resolve | Yes | Read | No | No | Yes |
| Analytics | Yes | Yes | No | Yes | No |
| Data console | Yes | No | No | No | No |
| Team and roles | Yes | No | No | No | No |
| Privacy requests and breach register | Yes | Yes | No | No | No |
| Global search | Yes | Yes | Yes | Yes | Yes |

Notes:

- Global search shows only the groups a person may open. A Support Agent sees pages and nothing else from institutes, people or invoices.
- A custom role gets whatever its permissions allow. The nav follows the same rules as the table.
- "Billing settings" also opens for anyone holding "Edit seat packs and user caps", so a custom role with only that permission can reach the pack prices.
- Super Admin status is checked in code, not through a permission. People, Data, Team, Roles, impersonation and "Run billing now" all call that check.

## 2. The Zinny panel, page by page

### 2.1 Sidebar and top bar

The sidebar is dark green and lists only the sections a person's roles allow. The sections are:

1. Overview
2. Institutes (with Sign-ups)
3. Plans and billing (Plans and prices, Licences, Invoices, Billing settings)
4. Users
5. Support (Support mode, Activity log)
6. Content review
7. Privacy (Privacy requests, Breach register)
8. Analytics
9. Data
10. Team (Team and roles, Roles and permissions)

Behaviour:

- A button collapses the sidebar to an icon rail with tooltips. The choice is stored in a cookie for a year.
- With no choice made, the sidebar is open on wide screens and a rail on tablets (768 to 1279 px).
- A gold bar at the top shows your own open support session.
- The top bar has breadcrumbs, a back button, the account menu and the greeting "Good morning, name" (by India time).
- People who are not on the Zinny team are sent to `/`.

### 2.2 Global search

Press `/` (when not typing) or Ctrl/Cmd+K anywhere in the panel. Below tablet width an icon button opens it.

- Empty search shows suggested pages.
- Results are grouped and ranked: names that start with the text, then a word that starts with it, then names that contain it.
- Groups: Pages and features, Institutes, People (Super Admin only, from 2 characters), Plans, Invoices, Courses in content review (from 2 characters).
- Each group shows at most 5 results. Arrow keys, Enter and Esc work.
- The text is cut at 80 characters.

### 2.3 Overview

The first page after sign-in. Every figure compares with the period before it.

**Date filter.** Today, Last 7 days, This month, Last month, Last 3 months, This year, or a custom From and To. The choice lives in the URL.

**Stats for the chosen dates:**

| Stat | Meaning |
|---|---|
| New institutes | Institutes created in the range |
| New learners | New student roles, one per person per institute |
| Enrolments | Enrolments made in the range |
| Student fees collected | Money students paid their institutes (paid, refund due or refunded orders) |

Two charts show enrolments and fees by day, week or month, depending on the range length.

**Current figures** ignore the range: active institutes (with the number suspended), active students (students with an active enrolment) and licences running today.

**Needs attention** lists, for the people who may see each kind:

- licence warnings (see below), each with "Mark as handled";
- institutes with no licence;
- overdue Zinny invoices;
- open content flags and published courses waiting for review;
- a "Plans and billing" row: plans on offer, renewals due in 30 days, unpaid total.

**Licence warnings:**

| Warning | When it appears | Becomes critical |
|---|---|---|
| Student cap or staff cap | Use reaches 90% of the cap | At 100% |
| Licence end | 30 days or fewer before the end date | After the end date |
| Renewal blocked | Auto-renew is on but the plan is archived | n/a |

A warning clears by itself when the cause goes. "Mark as handled" hides it, and it returns if it gets worse.

**Licence-end reminders** on the Overview use the same steps as the emails: 30, 14, 7 and 1 days. They turn urgent at 7 days and at 1 day, and stay once the date has passed. Each has a renew action.

Institute admins see the same reminder as a dismissible banner at the top of their admin area.

The page also lets a person with support access start a support session from a card.

### 2.4 Institutes

Needs "manage institutes".

**List.** Columns: name, status, students, staff, plan and licence end. Staff and plan columns show from 1280 px wide.

- **Search.** A combobox with a live dropdown. Ranking: name starts with the text, a word in the name does, the web address starts with it, then contains. Arrows, Enter and Esc work.
- **Status filter:** Active, Trial, Frozen, Suspended, each with a count. An institute counts as a trial when it is on the Pilot plan, or has a trial date and no licence yet.
- **Plan filter:** each plan, or "no plan".
- **Ending soon:** licences ending within 30 days.
- **Sorting:** click a column heading.
- **Paging:** 25 per page.
- A row grows into the detail page.

**Create an institute.** The team creates the institute through the core API. It invites the admin by email. A licence is optional at this point. Institutes set up this way have no trial date.

**Detail page.** Cards:

- Basics: name, web address (changing it breaks old links), time zone, invoice prefix, legal name, GSTIN, state, address. Saved changes go into the institute's audit log with the editor's name.
- Open content flags.
- Zinny invoices, with "New invoice".
- Users and usage: students and staff against the caps, departments, courses, active enrolments, the Institute Admin.
- Licence: plan, price before GST, term and renewal.
- Suspend or Reactivate.

**Suspend.** A reason of at least 5 characters is required.

1. Open the institute and enter the reason.
2. Choose "Suspend institute" and confirm.
3. The institute's people are sent to a "suspended" page when they try to open it. Their work is kept.
4. The Zinny team can still enter through support mode, view as a learner, or sign in as one of its people.
5. Licence warnings pause, and no licence-end emails go to a suspended institute.

**Reactivate.** An optional note. People can sign in again and warnings return. The core service also refuses any attempt by the institute itself to lift a suspension.

The handoff note for the team panel said suspension did not block access. That is out of date: `spaceContext` now redirects suspended institutes to `/suspended`.

### 2.5 Sign-ups

At `/platform/signups`. Needs "manage institutes". It lists institutes that signed themselves up, with status, trial end, days left, contact, GST answer and documents.

**Review a document.**

1. Open the institute and open each file.
2. Approve it, or reject it with a note of at least 5 characters (500 at most). The institute needs to know what to upload instead.
3. A document the institute has since replaced cannot be reviewed. Review the new one.
4. Every decision is audited under the reviewer's name.

**Extend a trial.** Enter 1 to 60 days.

- The new end date is the later of the current end date and today, plus the days. An already-ended trial therefore extends from today.
- A frozen institute becomes active again.
- Institutes the Zinny team set up have no trial and cannot be extended.
- A suspended institute must be reactivated first.

No email goes to the institute when a document is rejected or a trial is about to end. There is no notification kind for those yet.

### 2.6 Plans

At `/platform/plans`. Needs "manage licences". One row per plan: name, description, price and period, GST rate, student and staff caps, modules and the number of licences on it.

If no plans exist, three default plans are created:

| Plan | Price before GST | Period | Students | Staff | Modules |
|---|---|---|---|---|---|
| Pilot | ₹45,000 | 3 months | 100 | 10 | All except Website builder and Leaderboards and XP |
| Standard | ₹7,20,000 | 12 months | 1,000 | 60 | All |
| Enterprise | ₹24,00,000 | 12 months | 10,000 | 500 | All |

The team can add, edit, archive, restore or delete plans. Rules when saving:

- Name 2 to 60 characters. Description up to 300.
- Price in whole paise, 0 or more. Zero means a free plan.
- Billing period 1 to 120 months.
- Student and staff caps from 1 to 1,000,000.
- GST rate one of 0, 5, 12, 18 or 28 percent. The default is 18.
- Modules from the list: Course content and progress, Live classes and attendance, Tests, Assignments and polls, Certificates, Online payments, Reports, Leaderboards and XP, Website builder.

A price change does not touch existing licences. They keep their price until they renew, and then use the plan's price on the renewal day. An archived plan cannot be given to a new licence. Institutes can only buy plans that are not archived and cost more than zero.

Each plan can override the seat pack size and price (section 2.8).

### 2.7 Licences

At `/platform/licences`. Needs "manage licences". An institute has at most one licence.

A licence holds: plan, price and discount (with a required note when a discount is given), student and staff caps, modules, start and end dates, notes and an "auto-renew" switch. The licence form shows a live line such as "An invoice for ₹3,54,000 will be issued on 15 Nov 2026, due 25 Nov 2026."

Rules:

- The end date must be on or after the start date.
- The discount cannot exceed the price.
- Saving a new licence, changing its term or changing its plan raises a Zinny invoice in the same step. A net amount of zero raises none.
- Changing the caps by hand while keeping the same plan needs "Edit seat packs and user caps". Changing plan sets the caps agreed for that plan.
- The licence list shows usage against caps and "renews automatically" or "auto-renew off".

What the licence does in the app today: it is a commercial record, a usage report and a source of warnings. The code does not block enrolments above a cap, switch off a module that is not on the licence, or block access when a licence ends. Warnings and reminders tell the team and the institute.

### 2.8 Seat packs

A seat pack adds people to a licence's cap in the middle of a term, without changing plan.

**Defaults** (Billing settings, "Seat packs"):

| Kind | People per pack | Year price before GST |
|---|---|---|
| Student pack | 25 students | ₹2,500 |
| Staff pack | 5 staff | ₹3,000 |

A plan can override any of these four numbers. Editing defaults or a plan's packs needs "Edit seat packs and user caps". Without it the forms are read-only.

**Pricing formula:**

`charge = packs × year price × (months in the term ÷ 12) × (days left ÷ days in the term)`

- It is worked out in one division and rounded once to the nearest rupee (halves go up).
- Days left include the purchase day and the last day.
- A purchase before the term starts pays the whole term.
- A term that is not 12 months pays its share of the year. A 3-month Pilot pays a quarter of the year price.
- GST goes on top at the plan's rate.

**Worked example.** An institute buys 2 student packs on 1 October. Its term runs 1 April to 31 March, which is 365 days. Days left from 1 October to 31 March are 182.

| Line | Amount |
|---|---|
| 2 × ₹2,500 × (12 ÷ 12) × (182 ÷ 365) | ₹2,493.15, rounded to ₹2,493 |
| GST at 18% on ₹2,493 | ₹448.74 |
| Total | ₹2,941.74 |

For a Maharashtra institute (same state as Zinny) the GST is ₹224.37 CGST and ₹224.37 SGST. Otherwise it is ₹448.74 IGST.

**How packs work:**

- Caps on the licence always hold the total, packs included. Usage and warnings stay correct without knowing about packs.
- The institute buys on its own Seats page at `/{institute}/admin/settings/seats` (needs "manage settings"). The button shows the exact price, such as "Buy 2 packs for ₹339.84". If the price changes before the click, nothing is bought and the new price is shown.
- The Zinny team adds packs on the licence page. It can invoice them, or add them free with a written reason. It can also remove packs (newest first, reason required) or set caps by hand with an optional charge.
- Packs renew with the licence, on their own invoice per kind, at the pack price on the renewal day.
- Removing packs takes the seats off at once and stops renewal. Invoices already raised are left alone. There are no credit notes.
- No packs can be added after a licence has ended.

### 2.9 Billing and invoices

At `/platform/billing`. Needs "manage Zinny invoices".

**Invoice numbers** look like `ZNY/26-27/0001`: prefix, financial year (April to March) and a running number, at most 16 characters. Each financial year restarts at 0001.

**Invoice list.** Filter by status: all, unpaid, overdue, paid. Overdue means unpaid and past the due date. It is derived, not stored. Unpaid invoices show "Reminded" with a date.

**Create or revise.** The team can issue an invoice by hand, or edit dates, description, price and discount on an existing one. Every change is kept in the invoice's history.

**Mark paid.** Enter the date money arrived (not in the future) and a reference of 3 to 120 characters, such as a UTR. An invoice can be marked unpaid again with a reason.

**PDF.** "Open PDF" draws the shared GST invoice layout from the stored data. It is not stored.

**Coming up.** Licences ending in the next 60 days (8 shown, then "See all") with the end date, plan, when the renewal will be invoiced, the renewal total with GST, the auto-renew state, "Renew now" (or "Pick a plan" when the plan is archived) and a switch to turn auto-renew on or off.

**Automatic renewals.** The daily billing job renews a licence when all of these hold:

- auto-renew is on;
- the licence has not ended yet;
- its end date is within the renewal lead time (15 days by default);
- no invoice exists yet for the next term.

Then:

1. The next term starts the day after the end date and lasts the plan's billing period.
2. The price is the plan's price on that day.
3. The discount carries over if "keep a licence's discount on renewal" is on.
4. Seat packs still on the licence renew on their own invoices.
5. An invoice is dated today and due after the payment terms.
6. The history says "by Zinny, automatically".

A licence on an archived plan is not renewed. It gets a "Renewal blocked" warning: "Plan X is archived; pick a plan to renew". The warning clears when the plan is restored or the licence is renewed. A licence that has already ended is never renewed automatically. A person uses "Renew now". Otherwise a lapsed licence would bill terms nobody agreed.

**Payment reminders.** For each unpaid invoice the job sends the latest step on the schedule that has come and has not been sent. Missed steps are not sent in a pile. Nothing is sent on the day of issue. Changing the due date restarts the schedule.

| Step | Default |
|---|---|
| Before the due date | 3 days before (0 turns this off) |
| On the due date | On |
| After the due date | Every 7 days, at most 3 times |

Admins get an in-app notification and an email. There is no pay link, because Zinny invoices have no online payment. Suspended institutes are skipped.

**Licence-end reminders.** The same daily job emails and notifies the institute's admins at 30, 14, 7 and 1 days before the licence end date.

- Only the latest step that has come is sent. A step already sent for this end date is not sent again.
- A new end date (after a renewal) starts the sequence again.
- With auto-renew on, the text says "Your Zinny licence renews on …" and that an invoice will follow.
- With auto-renew off, it says the licence ends and asks the institute to renew.
- Nothing is sent once the end date has passed, or to an institute that is not active.
- The in-app notification is on by default. The email is sent directly by Zinny.

### 2.10 Billing settings

At `/platform/billing/settings`. Super Admin or Finance Admin can edit. Saving is audited with the values before and after.

| Setting | Default |
|---|---|
| Payment terms | 15 days |
| Renewal lead time | 15 days |
| New licences renew automatically | On |
| Keep a licence's discount on renewal | On |
| Payment reminders | On |
| Days before the due date | 3 |
| Remind on the due date | On |
| Days between overdue reminders | 7 |
| Most overdue reminders | 3 |

Seat pack defaults sit on the same page (section 2.8). A Super Admin also sees **Run billing now**, which runs the same job for every institute and reports, for example, "Renewed 1 licence, sent 1 reminder."

### 2.11 Users

At `/platform/people` (the menu says Users). Super Admin only. This is the one place that looks across institutes, so each view is logged.

- Groups: Everyone, Learners, Staff, Parents, Zinny team.
- Filters: text search, institute, group, role, account state (has a password or not), mobile number present, and joined dates. Sort by name, email, institute, joined or account. 50 per page.
- Password hashes are never shown, only whether one is set.
- A person's page lets a Super Admin edit name (2 to 120 characters), email (unique) and mobile.
- **Set password** applies the normal password rules and ends all the person's sessions by default. The password is never shown or logged.
- **Sign in as** and **View as** are described in section 2.12.

### 2.12 Support mode and impersonation

**Support mode** (Super Admin, Support Agent).

1. Pick an institute and write a reason of 5 to 300 characters, such as a ticket number.
2. A session opens for 120 minutes. Inside, the person acts as an Institute Admin of that institute.
3. Everything they do carries the session id in the institute's audit log.
4. They leave through the gold bar, or the session expires.

Only one session is open per person per institute. A Super Admin or Support Agent can force-end someone else's session with a reason. The "Support" page shows live sessions. The **Activity log** filters by institute, person, action and date, pages by 50 and exports up to 50,000 rows to CSV, with cells protected against spreadsheet formulas.

**Sign in as** (Super Admin only). The Super Admin becomes the person, with their full permissions, for at most 2 hours.

- It is refused for your own account, and while already signed in as someone.
- A banner shows who you are signed in as, and a return button goes back to the panel.
- The session stops if the Super Admin's role ends.

**View as** (Super Admin only) opens a student's screens read-only. Every change is refused with "You're viewing as …, so nothing can be changed." Starting and stopping are logged in the institute's log.

### 2.13 Content review and flags

At `/platform/content`. Content QA and Super Admin act. Account Managers can read flags to follow up with institutes.

- Tabs: To review, Flagged, Reviewed. Up to 200 courses per tab, filterable by institute.
- A read-only preview shows course details, batches with timings and faculty, and its flags.
- **Mark as reviewed** records that QA found nothing. It is refused while the course has open flags.
- **Flag** needs a category and a note of at least 10 characters (2,000 at most). Flagging also counts as reviewing.
- Categories: Wrong or outdated information, Misleading claims, Copyright or plagiarism, Quality of the material, Price or GST looks wrong, Against content policy, Something else.
- **Resolve** needs a note of at least 5 characters saying how it was fixed.

### 2.14 Analytics

At `/platform/analytics`. Needs "view analytics". All figures are in India time, weeks start on Monday, and the page can be narrowed to one institute.

- Stat tiles: students, active students, institutes (with suspended count), enrolments this week (and in 12 weeks), student fees this month (and in 12 months).
- Charts: enrolments per week and student fees per month.
- A table per institute: students, active students, enrolments in 12 weeks, fees this month and in 12 months.

Students are people holding a student role. Active students also have an active enrolment.

### 2.15 Data console

At `/platform/data`. Super Admin only. It lists every table in the database and lets a Super Admin read, create, edit and delete any row. It bypasses row-level security on purpose and is a documented exception to the module rules.

- Table and column names come from the live database catalogue, never from the request.
- Values are bound parameters, cast to the column type.
- Every insert, update and delete runs in one transaction with an audit entry: who, which table and row, and the values before and after.
- Password hashes, tokens and secrets are hidden and cannot be filtered, set or logged. Passwords are changed with "Set password".
- Primary keys and generated columns cannot be edited.
- A delete needs the word "delete" typed in.
- Lists page by 50.

### 2.16 Team and roles

Super Admin only.

- **Team** lists members and their roles. A Super Admin can invite a person by name and email and give a role, add a role to someone, or remove a role. A person who has not set a password yet is marked as invited.
- Duplicate roles are refused ("already has that role").
- **Roles and permissions** (`/platform/roles`) shows the team's roles, the defaults every institute starts from, or one institute's roles. A custom team role needs a name of 2 to 40 characters that does not clash with a built-in role, and at least one permission switched on. Up to 30 custom roles exist. A role held by people cannot be deleted. Only Super Admins change team roles.

### 2.17 Privacy

Needs "manage institutes" (Super Admin, Account Manager). See section 5 for the rules behind it.

- **Privacy requests** has two tabs: Zinny's own requests (marketplace learners and sign-ups), and every institute's queue with overdue counts. The team can answer only Zinny's own requests. Institutes answer theirs.
- **Breach register** logs incidents and tracks the 72-hour clocks.

## 3. The institute lifecycle

### 3.1 Book a demo or sign up

Two public routes lead in.

**Book a demo.** `/book-a-demo` shows the sign-up wizard, with a "Prefer a call first?" fold-out that holds a request form.

| Field | Rule |
|---|---|
| Name | Required, 2 to 80 characters |
| Institute | Required, 2 to 120 characters |
| Role | Optional, up to 80 characters |
| Phone | At least 10 digits, up to 15 |
| Email | Valid address, up to 200 characters |
| City | Optional, up to 80 characters |
| Message | Optional, up to 2,000 characters |

A hidden field catches bots. From one network, at most 3 requests an hour are accepted, and 30 an hour overall. The request is logged and emailed to every active Super Admin, who replies directly. No table holds demo requests.

**Self sign-up.** `/signup` offers "Sign up as institute" and "Sign up as student". The institute path is `/signup/institute`, a four-step wizard. Each "Continue" checks the steps so far.

1. **Institute.** Fields: name (2 to 120 characters), legal name, type, city, state, address and web address.
   - Types: Coaching institute, School, College, University, Skills or training centre, Other.
   - The state sets the GST state code and decides CGST/SGST or IGST on Zinny's invoices.
   - The address needs at least 10 characters and the PIN code, up to 500.
   - The web address (slug) is filled in from the name and checked for clashes. Letters, digits and hyphens only.
2. **Your account.** Contact person, email, mobile number, password and confirmation.
   - The password is 8 to 72 characters, and not common, not repeated characters, and not the email or name.
   - The email must not already have a Zinny account.
3. **GST.** The question is: "When you sell a course, does GST apply to your institute?"
   - Yes needs a 15-character GSTIN such as `27ABCDE1234F1Z5`, whose first two digits match the chosen state.
   - No stores no GSTIN. See section 4.3 for what changes.
   - Three consent boxes also appear: account and service are required, news is optional and unticked.
4. **Documents.** PDF, JPG or PNG, up to 10 MB each. The browser checks type and size, and the server checks again.

| Document | Required |
|---|---|
| PAN card | Yes. The institute's, or the owner's for a sole proprietorship |
| GST certificate | No |
| Partnership deed | No |
| Memorandum of association | No |
| Articles of association | No |
| Licence or registration | No |

5. **Start my free 3-day trial.** The server checks every step again, creates the institute, its Institute Admin and the trial in one go, signs the admin in and uploads the files in 3 MB parts.

Limits and results:

- At most 5 new institutes an hour from one network.
- The admin lands on the Documents page. Documents stay on file, and a replaced file is kept with a superseded mark. The PAN card can be replaced but not removed.
- Errors name the step and say how to fix the field.

### 3.2 The 3-day trial

- The trial end date is the sign-up day plus 3, in the institute's time zone. Sign-up day counts as day 1, so days 1 to 3 are usable.
- During the trial, people with "manage settings" see a gold banner at the top of the admin area.
  - "3 days left in your free trial. It ends on 27 Nov."
  - "Your free trial ends tomorrow, 27 Nov."
  - "Your free trial ends today."
- The banner carries a "Choose a plan" button. It does not show during support mode.
- The banner stops when a licence covers today.
- All modules work normally during the trial. No licence caps apply, because no licence exists yet.

### 3.3 Freeze on day 4

The job `onboarding.trial-freeze` runs hourly. When today is on or after the trial end date and no licence covers today, it sets the status to "frozen". It never deletes anything.

| Who | What they see |
|---|---|
| Admin with "manage settings" | Sent to Choose a plan. Can open only that page and the Documents page |
| Other staff, students, parents | Sent to a "paused" page: "{Institute} is paused for now. Your courses, marks and work are all kept." Links go to the marketplace or another sign-in |
| Zinny team (support mode, view as, sign in as) | Still get in |

Institutes the Zinny team set up have no trial date, so they are never frozen. The Zinny team can extend a trial from Sign-ups, which also unfreezes.

Deployment note: the repo's Vercel config schedules only the daily job. Hourly jobs, including this one, need a caller for `/api/jobs/run?every=hour` with the cron secret.

### 3.4 Choose a plan and pay

At `/{institute}/admin/choose-plan`. Needs "manage settings".

1. The page lists every plan that is not archived and costs more than zero, with price before GST, GST and total, caps, modules and period.
2. A usable PAN card must be on file. Otherwise the page says to upload it first.
3. The institute picks a plan. If a licence already covers today, it is refused: write to the Zinny team to change plans.
4. An order is created through the payment gateway for the total including GST.
5. After payment is confirmed:
   - a licence is created from the plan, starting today, running the plan's billing period (a 12-month plan bought on 19 Nov 2026 ends 18 Nov 2027);
   - the invoice is dated today and due today;
   - Zinny's GST invoice is raised and marked paid with the payment reference;
   - the status returns to active, with an audit entry;
   - the order is recorded in `onb_plan_orders`.

Today only the test gateway can complete this payment (section 4.5).

### 3.5 Licence active: caps and modules

- The plan sets student and staff caps, modules, term and price. The Zinny team can adjust any of these on the licence.
- Students count against the student cap. Staff include Institute Admin, Board Owner, Accounts and Fees, HOD, permanent and visiting faculty, and custom institute roles.
- Warnings appear on the Overview at 90% and 100% of a cap.
- The code records caps and modules and reports against them. It does not stop an admin adding people over a cap. The warning is the control.
- Auto-renew defaults to on for new licences.

### 3.6 Buying seat packs mid-term

1. An admin with "manage settings" opens Seats under Settings.
2. The page shows usage against caps and the packs held.
3. Choose the kind and number of packs. The price, CGST/SGST or IGST and the total show before buying.
4. Confirm. Seats are added at once, and a Zinny invoice is raised.
5. The invoice list on the same page has a **Pay** button that works only while the test gateway is on. Otherwise the invoice stays due, and the page explains how to pay by bank transfer.

Someone viewing as another person cannot buy. People with "view finance" can look.

### 3.7 Licence-end reminders

As in section 2.9: emails and notifications at 30, 14, 7 and 1 days before the end date, plus the banner for institute admins and the Overview list for the Zinny team.

### 3.8 Renewal: automatic or blocked

| Situation | What happens |
|---|---|
| Auto-renew on, plan live, 15 days or fewer to the end | Renewed automatically and invoiced |
| Auto-renew on, plan archived | Not renewed. "Renewal blocked" warning for the team |
| Auto-renew off | Reminders warn the institute that the licence ends. A person renews it with "Renew now" |
| Licence already ended | Never renewed automatically. A person uses "Renew now" |
| Institute suspended | Skipped for reminders |

The renewal invoice is due after the payment terms (15 days by default). Overdue invoices are chased on the schedule in section 2.9. The licence stays on after the end date. Nothing in the code closes an institute for a lapsed licence. The Zinny team suspends it by hand.

### 3.9 Suspension and reactivation

See section 2.4. Suspension is a manual decision by Super Admin or Account Manager with a logged reason.

### 3.10 Plan upgrades (Proposed)

Nothing here is built. The source is `docs/proposals/plan-upgrades.md`. It is a discussion paper for the client.

- An institute moves to a bigger plan on the day it asks. Caps and modules switch on at once.
- **Credit** for the old plan is `amount paid for the term × days left ÷ days in the term`. A discount is not credited twice.
- **End date options:** keep the same end date (recommended), or restart the term (suggested when under about 60 days are left).
- **Seat packs** are absorbed into the new plan and credited. Enough packs stay so the cap never drops.
- **Downgrades** happen only at renewal, with no credit.
- **Who:** the institute itself on the Seats page, or the Zinny team on the licence page. A new permission such as "Upgrade plans" would control the team side.
- **Billing:** recommended is a new tax invoice for the new plan plus a GST credit note for the unused part. Billing has no credit notes today, so that is new work.
- Worked example: Campus Plus (₹3,60,000) to Standard (₹7,20,000) with 182 of 365 days left. The institute pays ₹2,08,876.52 including GST.
- Eight open questions remain, such as the default end-date option, whether new caps start on invoice or on payment, and whether money is ever refunded.

## 4. Money

### 4.1 How Zinny invoices institutes

Zinny is the seller. Its details come from environment variables with these defaults:

| Variable | Default |
|---|---|
| `ZINNY_LEGAL_NAME` | Zinny Learning Private Limited |
| `ZINNY_STATE_CODE` | 27 (Maharashtra) |
| `ZINNY_ADDRESS` | Mumbai, Maharashtra |
| `ZINNY_INVOICE_PREFIX` | ZNY (up to 4 characters) |
| `ZINNY_GSTIN` | Not set. Set it before printing real invoices |

An invoice records the list price, discount (with note), taxable amount, GST, total, period, issue date, due date and the buyer's state. Invoices come from five sources: a new licence, a renewal, a plan change, a seat pack purchase, and a manual invoice.

### 4.2 GST on Zinny invoices

- GST is charged on every Zinny invoice, whatever the institute's own GST choice, because Zinny is the seller.
- The rate comes from the plan. The default is 18%.
- GST is `taxable amount × rate`, rounded to the nearest paisa.
- The institute's state against Zinny's state code decides the split:

| Institute state | Tax lines |
|---|---|
| Same as Zinny (27) | CGST half, SGST half |
| Any other state | IGST for the whole amount |

Odd paise go to SGST. The total is the same either way.

| Plan example | Before GST | GST 18% | Total |
|---|---|---|---|
| Pilot | ₹45,000 | ₹8,100 | ₹53,100 |
| Standard | ₹7,20,000 | ₹1,29,600 | ₹8,49,600 |

For Standard in Maharashtra: ₹64,800 CGST plus ₹64,800 SGST. In Karnataka: ₹1,29,600 IGST.

### 4.3 The institute's own GST choice

The wizard asks whether GST applies when the institute sells a course. The answer is saved as the GST setting, with the GSTIN. An Institute Admin with finance rights can change it later under Sales, Invoice settings ("Charge GST on fees"). The change is audited.

| | GST on | GST off |
|---|---|---|
| Order GST | Course GST rate added to the price | No GST on new orders |
| Student invoice | Shows the institute's GSTIN, and tax lines | A plain invoice with no GSTIN and no tax |
| Marketplace prices | Include the course's GST rate | Rate is 0 |
| Website checkout, manual and offline invoices | Charge GST | Charge no GST |

Other facts:

- A change applies to new orders only. Earlier invoices stay as they were.
- With GST on, the invoice settings warn when the legal name, address or GSTIN is missing.
- Student invoices are numbered `PREFIX/26-27/00042` (the institute's prefix, financial year, five digits).
- A student's state is not collected, so place of supply is the institute's own state. Student invoices always split into CGST and SGST.
- The marketplace cart falls back to 18% if it cannot find a course's rate. This is a known loose end.

### 4.4 Payment reminders

See section 2.9. Defaults are 3 days before, on the due date, then every 7 days up to 3 times. Delivery is an in-app notification plus a direct email. There is no pay link.

### 4.5 Razorpay: test gateway and live

The payment gateway is chosen at start-up.

| Setup | What happens |
|---|---|
| `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` set | Student checkouts go through Razorpay. `rzp_test_` keys run Razorpay in test mode with no real money |
| Neither set | The mock gateway is used |

The mock "Pay" button, which confirms an order with no money moving, works only in development or when `ZINNY_DEMO=1`. A live site without keys cannot hand out free payments.

For student fees, the payments module has a Razorpay webhook at `/api/payments/razorpay`. It needs `RAZORPAY_WEBHOOK_SECRET`. The hourly job `payments.reconcile` confirms payments whose callback and webhook were both missed.

**What is not wired:**

- Institutes cannot pay Zinny online with live Razorpay. The choose-plan and Seats pages offer payment only while the test gateway is on. Otherwise they say online payment is not switched on, and the institute contacts the Zinny team or pays by bank transfer. A function to confirm a plan payment exists, but no webhook calls it.
- Zinny invoices have no online pay link. Finance marks them paid by hand with a reference.
- No credit notes or refunds exist for Zinny invoices.
- No emails go out for a rejected document or an ending trial.

## 5. Privacy and DPDP from the platform side

This follows India's Digital Personal Data Protection Act 2023 and the DPDP Rules 2025. It is a product description, not legal advice.

**Who is responsible.**

| Situation | Data Fiduciary | Zinny's role |
|---|---|---|
| Students, parents and staff of an institute | The institute | Processor |
| Marketplace learners | Zinny | Fiduciary |
| The person who signs an institute up | Zinny | Fiduciary |

### 5.1 Consent records

Each consent is one row per purpose: account, service, KYC, marketing (news), analytics and guardian.

- Each row holds the notice version (now `2026-11.1`), granted and withdrawn times, the source and a salted hash of the IP address.
- Institute sign-up, student sign-up and KYC record consents. Account and service are required, and news is unticked by default.
- Withdrawing is one tap. Account and service can end only through an erasure request.
- A cookie banner on public pages offers essential cookies only by default, with an analytics switch. The choice is kept for 180 days.
- The notice is at `/privacy`, with a Hindi version of the essentials at `?lang=hi`.

### 5.2 Rights requests and SLAs

People file requests at `/{institute}/profile/privacy` for the institute's records, and `/privacy/my` for Zinny's own.

| Request | Zinny's promise | Notes |
|---|---|---|
| Download my data | Immediate | A JSON file. The PAN is masked. Each download is logged as a completed request |
| Correction | 15 days | Needs a description of at least 5 characters |
| Nominee | 15 days | Needs the nominee's name and an email or mobile. The nominee cannot yet act in the app and contacts the grievance officer |
| Erasure | 30 days | See 5.3 |
| Grievance | 30 days | Needs at least 10 characters |

The legal ceiling is 90 days under Rule 14(3). Overdue requests show in red, and the institute dashboard lists open ones. Only one open request of the same kind is allowed per person. A refusal needs a reason of at least 10 characters, so the person can complain to the Data Protection Board.

### 5.3 Erasure rules

When an erasure request is completed:

- name, email, mobile and password are anonymised, unless the same sign-in still holds a role at another institute;
- the KYC row is deleted;
- consents are withdrawn and the person's roles at that institute end;
- the person is signed out everywhere.

Kept by design: GST invoices (about 8 years under the CGST Act), and the consent and request log. The reply tells the person so. Consents and requests are never deleted.

### 5.4 Breach register and the 72-hour clock

At `/platform/privacy/breaches`. A person logs an incident with a title, a description, when Zinny became aware, when it occurred, data kinds, people affected, institutes involved and measures.

- The clock starts when Zinny became aware. The time cannot be in the future.
- Two 72-hour deadlines run from then: the detailed report to the Board, and notice to every affected person.
- Countdowns show gold under 24 hours left and red when overdue.
- Steps: first intimation to the Board, detailed report, notice to people, contained, closed. Recording the report also records the first intimation if it is missing.
- Closing needs both the report and the notice. An incident can be reopened.
- If the Board allows more time in writing, the incident records an extension.
- The register tracks. A person writes and sends the actual notices.

### 5.5 Retention

Each institute sets how long an inactive learner is kept and what happens next.

| Setting | Default | Range |
|---|---|---|
| Inactive period | 3 years (1,095 days) | 180 days to 10 years |
| Action | Flag for an admin | Flag, or anonymise |

The daily job `privacy.retention` flags learners inactive past the period and tells them by notification and email. It anonymises only 48 hours or more after flagging (Rule 8(2)). Signing in again clears the flag. Admins can keep a flagged account or anonymise it from the Retention tab. Education is not listed in the Third Schedule, so the 3-year default is Zinny's own choice.

Consent and request records are kept for at least one year, and in practice are never purged. Tax invoices are kept about 8 years.

### 5.6 Guardian consent for minors

- Student sign-up asks whether the learner is 18 or older, with an optional date of birth.
- For an under-18 learner, the form takes the guardian's name and email or mobile. A link valid for 7 days is sent. The link token is stored only as a hash.
- The guardian reads what is processed and confirms, which records a "guardian" consent.
- Until then, news and analytics are refused, tracking is off and the learner's home shows a gold card saying the app is waiting for the parent.
- Not built: identity-backed checks such as DigiLocker, and support for lawful guardians of persons with disabilities (Rule 11).
- Gamification, leaderboards and XP do not yet check the minor flag, so a minor can still see XP.

### 5.7 Open compliance work

Named in `docs/compliance/dpdp.md`: appoint a grievance officer (`PRIVACY_GRIEVANCE_*`), add a data processing agreement to institute contracts, sign sub-processor contracts, write a breach runbook, decide on consent managers (Rule 4, about November 2026), translate the full notice and write a log retention policy. Most other rules apply from about May 2027.

## 6. Scheduled jobs

Jobs run once per institute, as that institute's system actor, under row-level security. They are triggered by `GET /api/jobs/run?every=minute|hour|day` with `Authorization: Bearer $CRON_SECRET`. The repo's Vercel config calls only `every=day`, at 18:45 UTC (00:15 IST). Minute and hourly jobs need their own caller.

### 6.1 Jobs this reference covers

| Job | Runs | What it does |
|---|---|---|
| `zinny-team-panel.billing` | Daily | Renews licences that are due, sends payment reminders, then sends licence-end reminders |
| `zinny-team-panel.licence-alerts` | Hourly | Refreshes the 90% cap and 30-day licence warnings |
| `onboarding.trial-freeze` | Hourly | Freezes institutes whose trial ended without a licence |
| `privacy.retention` | Daily | Flags or anonymises inactive learners, with 48 hours' notice |

### 6.2 Other jobs on the platform

| Job | Runs | What it does |
|---|---|---|
| `core.daily-housekeeping` | Daily | Releases expired seat holds and warns HODs 14 days before visiting faculty access ends |
| `identity.housekeeping` | Daily | Deletes phone codes older than a day and clears old sessions, rate limits and expired links |
| `notifications-delivery.deliver` | Every minute | Turns notifications into emails and texts, sends what is due and retries failures |
| `notifications-delivery.cleanup` | Daily | Drops delivery records older than 180 days |
| `payments.reconcile` | Hourly | Confirms payments whose callback and webhook were missed, and finishes refunds |
| `assessments.close-expired-attempts` | Every minute | Submits timed tests whose time ran out |
| `assignments-polls.daily` | Daily | Reminds students the day before a due date and removes unsaved uploads |
| `assignments-polls.announce-polls` | Hourly | Tells students about polls that have opened |
| `certificates.expiry` | Daily | Expires certificates past their date |
| `gamification.close-challenges` | Hourly | Closes challenges that have ended |
| `live-classes.close-sessions` | Hourly | Closes ended live sessions |
| `live-classes.weekly-alerts` | Daily | Sends weekly attendance alerts |
| `content-progress.complete-finished` | Hourly | Completes enrolments whose content is finished |
| `content-progress.clean-uploads` | Daily | Removes abandoned uploads |
| `website-builder.housekeeping` | Daily | Removes site form submissions older than 7 days and clears stale files |

All jobs are idempotent. One failing job or institute never stops the others.
