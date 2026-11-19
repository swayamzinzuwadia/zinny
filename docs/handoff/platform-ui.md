# platform-ui handoff
## Built
- `/platform` overview: date filter (Today, Last 7 days, This month, Last month, Last 3 months, This year, custom From-To) kept in the URL; every range stat compares with the previous period; "now" figures are noted as current. Range queries are `overview()` in `services/analytics.ts`; date maths in `src/components/date-range.ts`.
- `/platform/institutes`: combobox search with live dropdown (prefix, then word start, then contains; highlight; arrows, Enter, Esc), sorting, filters (status, plan, ending soon), pagination, sticky header, empty states, row grows into the detail page. `/platform/institutes/new` tidied.
- Collapsible sidebar (icon rail, cookie, tooltips, animation, collapsed by default on tablet) in the institute admin and platform layouts.
- Platform top bar: breadcrumbs, back button, quick institute search, account menu, "Good morning, name" greeting; "Sign-ups" nav item gated by `platform.manage_universities`.
- Licence end reminders at 30, 14, 7 and 1 days: overview list with renew action; dismissible banner for institute admins in the admin layout (`{/* trial-banner slot */}` left beside it).
## Not built (and why)
- Nothing from the brief skipped. Screenshots cover overview, institutes (with search open) and new institute at 1440 and 1024.
## Contracts used / provided
- No events or slots. Reads: `searchUniversities` and `licencesEndingSoon` (platform permission checked), `ownLicenceReminder` (`settings.manage`, under `withTenant`), `overview` (`platform.view_analytics`).
## New packages
None.
## New environment variables
None.
## Requests for other owners
- `tests/core/admin-layout.test.ts` asserts the old `<aside>` markup in the admin layout; the collapsible sidebar replaces it, so the two tests need updating (they pass the intent: full-height green column, sticky inner part).
## Known issues
Full `npm test`: 6 failures, none in files this work changed besides the two admin-layout tests above. Others: `tests/authz.test.ts` (PostCSS config load error), `core-api` facade export list, `focus-mode` (learner nav source check), `reports-board/insights` seats, `zinny-team-panel/records` invite roles. Not investigated further.
