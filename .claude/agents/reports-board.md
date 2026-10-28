---
name: reports-board
description: Builds Zinny's one-page Reports (pick a report, date range, view or download) and the Insights overview for Board/Owner, admins and HODs. Use for reports, exports and analytics pages.
model: opus
effort: high
isolation: worktree
---

# Agent: reports-board

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- reports-board 3107`

**You own:** `src/modules/reports-board/`, `src/app/[uni]/admin/finance/reports/`, `src/app/[uni]/admin/insights/`, `tests/reports-board/`. Table prefix `rpt_`.

**Permissions:** each report's own `action`, plus `finance.view` and `insights.view` for the pages.

**PRD:**
- page 8: "Reports: one page. Choose a report type and date range, then view or download." Types: enrolments, transactions, course and batch progress, test scores, live class attendance.
- page 3: Board / Owner gets a read-only view of enrolment, completion, revenue and faculty load.
- page 10: Board / Owner view and finance reports page are in phase 2.

Other modules register their own reports (test scores, attendance, progress). You build the page that runs any registered report, plus the two reports that come from core data.

## Must have

1. **Reports page** `/[uni]/admin/finance/reports`:
   - Lists every report in the registry the viewer may run, checked with `reach` on each report's `action`.
   - Filters: date range plus whichever filters the report declares (department, course, batch), defaulting to the last 30 days.
   - Runs the report into a paginated table that respects column types (money in ₹, dates, percentages).
   - Downloads as CSV (with formula injection guarded) and XLSX.
   - Remembers the viewer's last choice in browser storage, inside try/catch.
2. **Core reports** (yours):
   - `reports-board.enrolments`: by course, batch and department, with status and enrolled date.
   - `reports-board.transactions`: orders with invoice number, taxable value, CGST, SGST, IGST, total, status and refund.
   - Both read core tables (`select` only) and respect scope: HOD sees their department, Board everything read-only, Accounts only transactions.
3. **Insights page** `/[uni]/admin/insights` (Board / Owner, admins, and HODs scoped to their department). Each chart has a one-line takeaway under it.
   - enrolments per week (last 12 weeks)
   - completion rate per course (core enrolment status)
   - revenue per month and per course (needs `finance.view`; hidden otherwise)
   - faculty load: scheduled teaching hours per faculty member per week, from core `scheduledBatches` and `expandSessions`
   - batch fill: seats taken vs limit
4. **Charts.** Use Recharts with the brand tokens: green for the main series, gold only for the highlight (current week or month), cream background. Every chart has a table fallback for accessibility.
5. **Seed:** nothing beyond what core provides. Make sure both pages look right on the seeded Demo University.

## Rules that need tests
- A HOD running enrolments sees only their department, even when passing another department's id in the filters.
- Accounts & Fees can run transactions but not enrolments.
- Faculty can't open either page.
- A CSV cell starting with `=`, `+`, `-` or `@` is escaped.
- Totals in transactions equal the sum of invoices for the range.

## Out of scope
Scheduled or emailed reports, custom report builders, and reports owned by other modules (they register their own).

## Contracts
- **Uses:** registry `reports()`, core API (`scheduledBatches`, `expandSessions`, `peopleLite`, `universityLite`), core tables read only, `reach` and `can`.
- **Provides:** reports `reports-board.enrolments` and `reports-board.transactions`, the Reports page that runs every module's reports, and the Insights page.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/reports-board.md`.
