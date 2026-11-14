# UI declutter plan

Method: the unslop skill by Damir Sokolovsky (@heydamir, CC BY 4.0), run in polish mode. Zinny already has a real brand (chalkboard green, gold, cream, Lexend), so the palette, type family and pill buttons stay. What changes is density, hierarchy and repetition.

## Direction

- **Product.** Zinny runs an institute's courses, batches, fees and students.
- **Character.** Calm, orderly, a little warm. A well-kept staff-room register, not a control room.
- **World.** Chalkboard and paper: the green board, cream paper, one gold chalk mark.
- **Moments.** One per screen. Admin and learner home: the green "today" board. Insights: the enrolments chart. Everything else is quiet paper.
- **Signature.** The gold "now" marker. Gold means "happening now" or "the one thing that needs you first", and nothing else.

## Audit: why the dashboards feel cluttered

Measured at 1440 px wide with the demo data (learner at 390 px).

| Screen | Height now | Cards | Target height |
|---|---|---|---|
| Admin dashboard | 3,447 px | 14 | 1,800 px or less |
| Learner home | 3,911 px | 12 | 2,300 px or less |
| Insights | 2,133 px | 10 | 1,600 px or less |
| Zinny team overview | 1,166 px | 9 | 1,000 px or less |

1. **The same fact shown two or three times.** Admin: new enquiries appear in "Needs you", five times in "Updates" and again in "Website". Today's class is in the board's timeline, its bullet list and "Today's classes". Seats are a stat and a dot grid. Learner: the live class is in the hero, in "Today" and again in "Your class is on".
2. **No hierarchy.** Fourteen cards of the same weight, in no order of importance. The four headline numbers sit fourth, under an invite banner.
3. **Boxes inside boxes.** Almost every card holds tinted, rounded sub-cards, each with its own buttons. The eye has to parse three levels of outline.
4. **Gold everywhere.** Gold-filled blocks for warnings, gold count pills, gold outlines on "due soon". When five things are gold nothing is.
5. **Noisy data marks.** "Seats by batch" draws up to 30 small squares per batch. Insights has five charts of nearly the same size, each in a tinted panel inside a card.
6. **Stretched and empty cards.** Paired columns stretch the short card to the tall one's height, leaving large blank areas (Today's classes, Marketplace sales, Revenue by course).
7. **Dense table rows.** A Students row carries a badge, a scope, an underlined "Remove", two department chips and two disclosure triangles: seven things to read per person.
8. **Small tells.** Greeting headlines ("Good afternoon, Asha"). Money in two formats on one screen (₹4,481.64 and ₹3,798). Negative letter spacing on body text. Semibold everywhere. 22 px card corners with 16 px inner corners.

## System rules (apply everywhere)

- **Radius.** Cards, tables, stats, empty states: 16 px. Rows and tinted areas inside a card: 12 px. Inputs: 12 px. Buttons and badges stay pills (brand). `--radius-board` 1.25rem.
- **No card inside a card.** Lists inside a card are plain rows separated by a hairline (`divide-y divide-line`), 12 px vertical padding, no background. A tinted background is allowed for one row per card at most: the one that is "now".
- **Gold.** Only: the now marker, the live class, the current period in a chart, and the first item of a "needs you" list when it is urgent. Other warnings: ink text with a small gold dot (8 px) at the start of the row. Overdue money: `text-danger` on the amount only, no pink block.
- **Type.** Weights 400 and 500; 600 only for the page title. Stat figures 28 px / 500. Card titles 16 px / 500. Body 14 px. Meta 13 px muted. Body letter spacing 0 (remove `-0.005em`); headings keep `-0.02em` only at 24 px and above.
- **Numbers.** `tabular-nums` on every figure. On dashboards money is whole rupees (₹4,482). Paise only on invoices, receipts and payment forms. Every change says what it compares to ("12 joined this week").
- **Titles.** No greeting headlines. The title names the page or the day ("Saturday, 14 November", "Overview").
- **Lists are capped.** A dashboard list shows at most 5 rows (3 on a phone), then one quiet link "See all 11".
- **One action per row.** A row has one primary action (a small button or a link). A second action is a quiet text link. More go behind the row's detail page.
- **Grids never stretch.** Two-column areas use `items-start`. Put the taller column where it reads first; do not pad the short one.
- **Spacing.** 4 px grid. Card padding 20 px (24 px for the page's main card). Gap between cards 16 px, between page sections 24 px. Remove one-off values like `gap-[5px]`, `mt-[13px]`.
- **Motion.** No `transition-all`; name the property.
- Copy rules from CLAUDE.md still hold. No horizontal scroll at 390, 820, 1280, 1440.

## Screen plans

### Admin, HOD and faculty dashboard (`src/app/[uni]/admin/page.tsx` and the `dashboardCards` slot cards)

Order, top to bottom:

1. **Today board** (the moment, green). Title is the date. Keep the hour timeline with the gold now-marker. Remove the greeting and the bullet list on the right (they repeat "Needs you"). About 200 px tall; when there is no class today it collapses to a one-line strip "No classes today".
2. **Quick actions** move into the page's top-right action area as the existing pill buttons. No card around them. Add "Invite students" here; it opens the joining code, link, WhatsApp and poster options that the "Invite students" card has now. Remove that card from the dashboard (keep the full card while the "Get set up" checklist is still showing).
3. **Four numbers** in one row: Enrolled students, Open batches, Collected this month, Seats filled.
4. **Two columns, 3:2, `items-start`.**
   - Left, one card **"Today and needs you"** made of two plain lists under small headings. *Today's classes*: one row per class: time, name, student count, "Take attendance" button, quiet links "Mark everyone present", "Move", "Cancel"; "Start class" replaces "Take attendance" as the primary while the class is live. *Needs you*: flat rows, one action each, capped at 5 with "See all". Fold in what the Website card and the grading cards say: "3 new enquiries", "2 reviews to approve", "1 faculty profile to approve", "11 assignments to grade", "1 test to grade", each one row with a count and one link.
   - Right, card **"Batches filling up"**: one row per batch: name and batch on one line, a single 6 px bar, "3/8" right-aligned. Fullest first, cap 6, link "See all batches". No dot grid on the dashboard (`SeatMap` dots stay on the batch page).
5. **One row of three small cards, `items-start`:** *This month* (marketplace sales and certificates issued as two label–figure lines with their links), *Top learners* (top 3 only, no progress bars, XP right-aligned), *Updates* (cap 5, group repeats: "5 new enquiries" is one line, and drop anything already in "Needs you").

Remove the separate cards: Website, Assignments to grade, Tests to grade, Certificates issued, Marketplace sales, Invite students. Their content lives in the places above. Modules still own their data: keep each module's loader and render through the slot, but change what the slot entry returns (a row for "Needs you", a line for "This month") or add a compact variant.

### Learner home (`src/app/[uni]/learn/page.tsx`, 390 px first)

1. Green board: date as the title, then the live or next class with "Join class". Remove the greeting.
2. Week strip (keep).
3. Remove the "Today" card when it only repeats the board's class; when there are two or more classes today, list the others as rows under the board. Remove the second "Your class is on" card completely.
4. **Due soon**: plain rows, cap 3, a gold dot only on items due today. No outlined gold boxes, no "Due soon" pills.
5. **Continue learning**: one primary lesson with its progress bar, then the other courses as two compact rows with a percentage.
6. **Tests**: cap 3, then "All tests".
7. **Updates**: cap 3, then "See all".
8. **XP**: one compact card: figure, "+210 this week", rank line, and the sprint as one progress bar.
9. **My courses**: compact rows (name, batch, timing), not one card each.
10. Marketplace: one link row at the end, not a card with a paragraph.

The fixed tab bar stays. Check that nothing hides behind it.

### Insights (`src/modules/reports-board`)

- Four numbers, then **one main chart**: Enrolments per week, full width, about 300 px tall, no tinted panel behind it, muted grid, gold only on the current week.
- Below, two columns `items-start`: *Completion by course* and *Batch fill* as ranked lists with thin bars (6 px), no tinted panel, no axis ticks (the value is printed at the end of each row).
- *Revenue*: one card with "Revenue per month" as a small bar chart (160 px) on the left and "Revenue by course" as a ranked list on the right.
- *Faculty load*: ranked list with thin bars.
- "Show as a table" becomes a quiet link in each card's header hint, not a row under the summary sentence. Keep the summary sentence; it is the most readable thing on the page.

### Zinny team overview (`src/app/platform/page.tsx`)

- Title "Overview", the warning counts as the subtitle (already there). No greeting.
- Four numbers in one row at the top.
- "Needs attention" as flat rows with a gold dot (danger text for the overdue amount), one action each. No filled gold or pink blocks.
- Right column: "Start a support session" form. "In support mode now" and "Recent support activity" merge into one card "Support".

### People lists and other admin tables

- A person's row is two lines at most: name and email; then role, scope and departments as one muted text line ("Current student · Whole institute · Computer Science, Marketing"). One "Manage" disclosure on the right holds remove role, departments and the rest.
- The bulk bar ("Select all … Tick students to add") shows only when at least one row is ticked; until then a single muted line "Tick students to add them to a batch".
- `Table`: header 13 px muted, rows 52 to 56 px, `px-4`.
- Apply the system rules to the other list pages you touch (courses, batches, invoices): no nested tinted boxes, one action per row.

## Not changing

Sidebar and navigation, the colour tokens, Lexend, pill buttons, page routes, permissions, any service rule, public marketing pages.

## How to check

- Screenshot each screen before and after at 1440 (learner at 390) and compare the page heights with the targets above.
- No horizontal scroll at 390, 820, 1280, 1440 on every page touched.
- `npm run typecheck`, `npm run lint`, `npm test` (4 known failures only). Update tests that assert removed copy; never skip one.
- Every action that existed before is still reachable in the same number of clicks or fewer (the daily-flow click counts in `docs/handoff/dailyflows.md` must not get worse).
