# data-console handoff

Built as integrator on request: "I want Zinny super admin to have all the CRUD rights for each and everything in the database."

## Built

- **Data** section in the Zinny team panel (`/platform/data`), in the sidebar for Super Admins only. Every other platform role and every institute user is refused by the service (`assertSuperAdmin`) and sees "You don't have access" on the pages.
- **Tables index** (`/platform/data`): every table in the `public` schema, read live from `pg_catalog`, so new module tables appear by themselves. Grouped Core first, then one group per module prefix (`asgn_` Assignments, `plat_` Zinny team panel, and so on). Shows a readable label, the raw name, an exact row count and whether the table is kept per institute. Has a search box. Only drizzle's `__drizzle*` bookkeeping is hidden.
- **Table view** (`/platform/data/<table>`): 50 rows per page, sort by any column (click the header), text search across text, choice and id columns, and an institute filter on tables with `university_id`. Institute names are shown instead of ids. Foreign-key uuids link to the row they point at, labelled with its name, title or email when it has one. A `?filter=<col>&value=<v>` filter backs the "Rows that point here" links. Long values are cut at 60 characters. The table scrolls inside its own box. Bulk delete works on the ticked rows after you type `delete`.
- **Row page** (`/platform/data/<table>/row?key=…`): an edit form built from the column metadata. Text uses an input, or a textarea for long text. Numbers use a number input; `_paise` columns show a rupee helper ("Now ₹7,20,000"). Booleans use a checkbox and enums a select of their values. Dates use the date picker. Timestamps use a native datetime-local with seconds, in India time; `time` uses a time input. json and jsonb use a textarea checked as JSON. Arrays use a textarea, one value per line or a JSON array. uuids use an input with a link to the row. Nullable columns have a "Leave empty (null)" box. Primary keys, generated and identity columns are read-only. The page also has an About card (institute link; for users, a link to their People page), counts of the rows that point at this one with links, and a delete card that needs you to type `delete`.
- **Add a row** (`/platform/data/<table>/new`): empty fields are left out, so the database fills in defaults such as ids and `now()`. Each field's hint says what an empty value means. After saving, the page goes to the new row.
- **Errors in plain words**:
  - A blocked delete: "Can't delete: 29 rows in audit_log point to this. Delete those first." It counts every restricting foreign key and lists each table.
  - A link to a row that doesn't exist: "The value in university_id doesn't match any row in universities. Use the id of a row that exists there."
  - Unique values, required fields, check rules (named) and badly formatted values each get their own message.
- **Safety**:
  - Columns whose name contains hash, secret, token or password are masked (••••••) in lists, rows and the audit log. They can't be sorted, filtered, searched, inserted or updated. On users, the page links to Set password instead.
  - Table and column names from the request are only looked up in the introspected catalogue. Only the catalogue's own spelling reaches SQL, through `sql.identifier`. Types come from `format_type` in the catalogue, and every value is a bound parameter. The sort direction is limited to asc and desc.
  - Writes run in one transaction with a `FOR UPDATE` read of the row before. Only the values that actually changed are written.
  - Each change writes `plat.data.insert`, `plat.data.update` or `plat.data.delete` through `logAction`. The entry records the actor, table, row key, changed columns and before and after values, with secrets masked. It carries `data.universityId` for the row's institute, so it appears in the activity log ("All Zinny team activity") as "Added, Changed or Deleted a row in Data", with "Table: … · Row: … · Changed: …".
- **The documented exception**: `src/modules/zinny-team-panel/data-console.ts` uses `systemDb()` (the owner role, which bypasses RLS) for reads and writes across every module and institute. The header of the file explains why and what keeps it safe. `tests/zinny-team-panel/support-universities.test.ts` now skips this one file in its "no raw core writes" guard.
- **"Open in Data"** buttons on each institute's platform page (Super Admins) and each person's platform page.
- **Plans** (`/platform/plans`): checked end to end in the browser as zara. Create, edit, a price change (the header updates; existing licences keep their price), archive and restore all worked and were logged. Plans was already in the sidebar under Institutes. What was missing was delete, so I added "Delete plan". It works only when no licence uses the plan, and refuses with "Archive it instead" otherwise. It also refuses on the last remaining plan, because the defaults would come back. It is logged as `plat.plan.delete` ("Deleted a plan").

## Not built (and why)

- Composite foreign keys are not shown as links. Only single-column foreign keys are; there are none of the other kind in the schema today.
- Tables without a primary key (`domain_event_deliveries`, `pay_bundle_orders`, `student_departments`) find rows by `ctid`. That position changes after an edit, and the page says so.
- Secret columns can't be set when adding a row. Inserting into `sessions`, `idn_invites`, `idn_tokens` or `idn_otp_challenges` therefore fails with "token_hash can't be empty". That is deliberate.

## Contracts used / provided

- No events. Core `audit` through `logAction`. Reads `pg_catalog` directly. Writes every table on the owner connection (the documented exception above).
- New platform audit actions: `plat.data.insert`, `plat.data.update`, `plat.data.delete`, `plat.plan.delete`.

## New packages

None.

## New environment variables

None.

## Requests for other owners

- `docs/plan/ownership.json` has no "dataconsole" agent, so `npm run check:ownership` can't run for this branch. I worked as integrator; every file changed is under `src/modules/zinny-team-panel/`, `src/app/platform/`, `tests/zinny-team-panel/`, `tests/data-console/` and `docs/handoff/`.

## Known issues

- Timestamps are edited in India time (Asia/Kolkata) to the second. Fractions of a second are dropped only when you change that field.
- Row counts on the index are exact `count(*)` per table. That is fine at today's sizes but should become estimates (`reltuples`) for very large tables.
- Files changed:
  - `src/modules/zinny-team-panel/data-console.ts`, `data-actions.ts`, `lib/data-links.ts`, `components/data-fields.tsx`, `components/select-all.tsx`
  - `src/app/platform/data/**`
  - `lib/access.ts` (sidebar), `services/support.ts` (log labels), `services/plans.ts` and `actions.ts` (delete plan)
  - The plans pages, and the institute and person pages
  - Tests: `tests/data-console/data-console.test.ts`, `tests/zinny-team-panel/plans.test.ts`, `permissions.test.ts`, `support-universities.test.ts`
- Tests: `npm test` gives 1607 passing and the 4 known baseline failures (core-api export list, focus-mode, reports-board insights, records "Super Admins invite people"). typecheck and lint are clean.
- Screenshots are in `docs/handoff/data-console/`: index, table views at 390, 820 and 1280, row pages, new row, refused delete, activity log and plans. No page scrolls sideways at 390, 820 or 1280.
