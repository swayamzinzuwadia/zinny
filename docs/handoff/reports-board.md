# reports-board handoff
## Built
- Reports page /[uni]/admin/finance/reports. Opens for finance.view or insights.view in any scope (Admin, Board / Owner, Accounts & Fees, HODs); faculty and learners see a no-access message. Lists registered reports whose own action the viewer holds (reach). Filters: report; date range (last 7/30/90 days, this or last month, this or last financial year, custom; default 30 days, university time zone, max 5 years); plus whichever of department/course/batch the report declares, cascading, choices limited to the viewer's reach. Only declared filters reach run(); URL ids outside reach are refused with a message. Module report failures show a plain message (AppError messages pass through). Table is paginated (50 rows), formats ₹/dates/percents, right-aligns numbers, shows negatives in red, and totals money columns across all rows. Downloads: CSV (BOM, CRLF, RFC 4180, formula-injection guard on text cells; numeric columns stay numbers so negative marks survive) and XLSX (own writer + fflate; typed cells, bold frozen header, autofilter). Each download is audited as report.exported. Last choice is kept in localStorage per university and person (try/catch) and restored when the URL has none.
- reports-board.enrolments (enrolment.view): enrolled on, student, email, department, course, batch, status. Only paid or free enrolments, not unpaid seat holds.
- reports-board.transactions (finance.view): date, invoice, student, email, department, course, batch, status, taxable value, CGST, SGST, IGST, invoice total, refunded, payment reference. Money comes from invoices, so totals = invoices issued in the range. Both reports read core tables with select only and scope rows themselves: HOD gets their own department, Board everything, Accounts transactions only.
- Insights /[uni]/admin/insights (insights.view; HODs scoped to their department). Stats, then enrolments per week (12 weeks, this week gold), completion by course, revenue per month (this month gold) and per course (before GST, refunded orders excluded, finance.view only), faculty load (last/this/next week from scheduledBatches + expandSessions; attributed to whoever was assigned at session time), and batch fill. Every chart has a takeaway line and a "Show as a table" fallback. Recharts in brand tokens on a cream panel.
- Tests: 77 in tests/reports-board (full suite 226). Screenshots in docs/handoff/reports-board/.
## Not built (and why)
No rpt_ tables (nothing stored server-side); no module seed (brief: nothing beyond core); scheduled/emailed reports and report builders are out of scope.
## Contracts used / provided
Provides the two reports and both pages; no events or slots. Uses reports(), withTenant, audit, reach, universityLite, todayFor, peopleLite, scheduledBatches, expandSessions, spaceContext and @/server/errors; reads core tables enrolments, orders, invoices, batches, courses, departments, users, role_assignments with select only.
## New packages
recharts ^3.10.1, react-is 19.1.0, fflate ^0.8.3
## New environment variables
None.
## Requests for other owners
- Core menu.ts: add a Reports item for HODs (their Finance section is hidden).
- Core [...rest]/page.tsx: remove the finance/reports and insights placeholders.
## Known issues
In-memory pagination (the contract returns all rows; 5-year cap). XLSX money format groups digits in threes, not lakhs.
