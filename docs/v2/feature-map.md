# Zinny v2 feature map

Stage labels are defined in [the master plan](README.md), section 3.4.

## 6. Feature map

Each area lists what is kept, what changes and what is new. The stage is in brackets.

### 6.1 Direct channel: the website connection (1B)

Everything here is new. Working name: **Zinny Connect**.

**How it works for a student**

1. The student signs up and pays on the institute's website.
2. The site tells Zinny: this student, this order.
3. Zinny creates the student record, gives it a student ID, and either places the student in a batch by rule or puts them in the institute's Arrivals list.
4. The student clicks "Go to my classes" on the institute's site and lands in Zinny already signed in, limited to that institute.
5. First visit: confirm the mobile number with a code, read the privacy notice, add a guardian if under 18. After that they can sign in to Zinny on the web or the app directly with a code or a password.
6. The student gets "Your classes are ready" by email, SMS or WhatsApp, with the link and the app links.

**Ways a site can connect** (an institute picks one or more)

| Way | For | Stage |
|---|---|---|
| REST API with keys | Sites with a developer | 1B |
| WordPress plugin (user sign-up and WooCommerce orders; Tutor LMS, LearnDash and LearnPress products) | The most common coaching sites | 1B |
| Payment gateway listener: the institute adds a Zinny address to its own Razorpay account and Zinny reads paid orders from it | Sites with no developer | 1B, after the API and plugin |
| CSV upload with site IDs and orders (extends today's import) | One-off and catch-up loads | 1B |
| Cashfree, PayU, Instamojo, PhonePe listeners | Other gateways | after launch |
| Zapier, Make, Pabbly, Google Sheets | No-code sites (Wix, Shopify, Google Forms) | after launch |

**The API (version 1)**

- Keys: per institute, test and live, named, scoped (students, orders, catalogue, sign-in handoff, webhooks), shown once, stored hashed, rotate with an overlap period, revoke, last-used time, optional IP allow list.
- Rules for every call: bearer key, idempotency key on writes, rate limits with headers, one error format, cursor paging, version in the path.
- Students: create or update by the site's own ID; read; deactivate; bulk load.
- Orders: create or update by the site's order ID with items, amounts, tax, coupon, gateway reference, paid time and status; refunds.
- Catalogue: read courses, batches, fees, seats left and timings, so the institute's site can list them.
- Sign-in handoff: ask for a one-time link for a student (single use, short life, optional landing page such as a course or the timetable).
- Read back for the site's own student dashboard: enrolments, progress, attendance, certificates.
- Enquiries: push leads from the site's forms into the institute's enquiry inbox.
- Events: a polling feed for sites that cannot receive webhooks.

**Messages Zinny sends back to the site** (signed, retried, logged)

Student created or updated; student ID assigned; placed in a batch; batch switched; enrolment ended or completed; order recorded or refunded; fee due or paid; class scheduled, moved or cancelled; daily attendance summary; test result published; certificate issued or revoked; student erased on request.

**Institute admin: Settings, Website connection**

- Setup guide that asks how the site is built and shows only the matching steps.
- API keys and webhook addresses: create, test-send, delivery log, retry, replay, automatic pause after repeated failures.
- Product mapping: the site's product or plan ID to a Zinny course and batch, with an unmapped list and name-based suggestions.
- Placement rules per product: a fixed batch, the next open batch with a free seat, or hold for staff. What to do when the batch is full: waitlist or Arrivals.
- Field mapping: the site's extra fields (class, school, parent name and phone, city) to custom student fields.
- Sign-in handoff setup: secret, allowed return addresses, the "Go to my classes" button code, a test link.
- Sync monitor: last event, error rate, searchable log with personal data masked, failures with the reason and a Replay button.
- Duplicates list: same phone or email under two site IDs, with merge.
- Reconciliation: counts per day against an export from the site; differences listed.
- Test mode: test keys, sample events, test data kept apart from real students.
- Go-live checklist.

**Institute admin: Arrivals**

- A list on the dashboard's "Needs you": students who paid on the website and are not yet in a batch.
- Place one or many in a batch; flags when the amount paid differs from the fee or the product is unknown.

**Zinny team: Integration desk**

- A board of every direct institute by stage: not started, keys issued, test events seen, mapping done, live.
- Owner, notes and checklist per institute; alerts when a live connection goes silent or error rates climb; logs visible in support mode.

**Developer site**

- Quick start, API reference from an OpenAPI file, webhook guide, sign-in handoff guide, plugin guide, sample code in PHP, Node and Python, a Postman collection, change log.

### 6.2 Students, IDs and credentials (1A core, 1B screens)

- **New**: one student record per institute, separate from the login: student ID, where they came from (website, white-label site, marketplace, added by staff, import, joining code), the site's ID, status (applicant, active, on hold, left, alumni), custom fields, guardian details, documents, and a timeline of joined, paid, placed, attended and tested.
- **New**: student ID format per institute (prefix, year, department code, running number, such as `SCC/26/0001`); assigned on admission or on placement; manual override; bulk assign; unique inside the institute; searchable; printed on certificates, invoices and attendance sheets.
- **New**: ID card with photo and QR code, printable singly or by batch.
- **New**: credential tools for staff: send a sign-in link, reset a password, sign a student out everywhere, lock and unlock, change phone or email with a code, see sign-in history.
- **Change**: student lists gain filters for source, batch, fee status and status, and an export.
- **Change**: signing up with an email that already exists says "You already have an account, sign in to join" instead of refusing, and staff adding an existing person no longer attaches them silently.
- **Keep**: joining code and link, join requests with approval, bulk CSV import, quick add, link a parent, graduate to alumni.

### 6.3 White label (1C)

**Web addresses**

- Add addresses: one for the app (such as `learn.institute.com`), one for the website (`institute.com`), or a single address for both.
- DNS instructions, automatic checking, automatic security certificate, status, redirects (www to the bare address, old address to new).
- A neutral fallback address that does not contain the word Zinny, used until the institute's own address is live.

**Brand studio** (Settings, Brand)

- Name and short name; logo for light and dark backgrounds; browser icon and app icon.
- Colours: one primary colour with the shades worked out automatically and contrast checked; optional accent; optional page background.
- Font from a short approved list.
- Sign-in page picture and welcome line.
- Email header, footer and signature; sender name and address on the institute's own email domain with setup checks; a neutral sender until that is done.
- SMS sender ID and DLT registration details; WhatsApp number.
- Support contact shown in help: email, phone, hours.
- Legal pages at their address: terms, privacy notice, refund policy, grievance officer, cookie notice, with starter templates.
- Social links. "Powered by" is off by default.
- Live preview of the sign-in page, learner home, admin panel, an email, an invoice and a certificate before saving.

**Every surface carries the institute's brand, with no Zinny name**

Public website; sign-up, sign-in, reset, invitation and guardian pages; learner portal; admin panel; parent view; every email including sign-in and reset; SMS and WhatsApp text; invoices and receipts; certificates and the verify page at their address; PDF file details; error, not-found, paused and suspended pages; page titles, icons and share images; the installable web app; the payment window; the joining poster; exports. Zinny support staff appear only as "Support".

**Accounts**

- A private set of accounts per institute: the same email can exist at another institute or on Zinny with no clash and no hint.
- Sign-up and sign-in happen only at the institute's address. No institute picker.

**Selling on their own site**

- Course pages and checkout at their address, paid through their own gateway connected in Settings (Razorpay first).
- This brings back paid checkout for an institute's own courses, which today exists only on the marketplace.

**Website builder at their address** (the builder exists; these are added)

- Extra pages and a navigation menu; SEO title, description and share image per page.
- Analytics and ad tags (Google Analytics, Meta) loaded only with cookie consent.
- Announcement bar; more page designs.
- Sitemap and robots file at the root of their address.

**Other**

- The Zinny marketplace is hidden inside a white-label portal. The institute can still choose to list on it.
- A white-label institute that keeps a separate marketing site can use the website connection from 6.1.

### 6.4 Dedicated installations (1H)

- The same code run for one institute, with its own database, file storage and address.
- A link back to Zinny for the licence, version, health and usage.
- Updates reach dedicated customers after the shared platform, on a set schedule.
- Support access through short-lived, logged tokens.
- Backup and restore policy; data export; a service agreement.
- Sign-in with the institute's own staff directory (SAML or OpenID) offered on this tier.
- A tool to move an institute from the shared platform to a dedicated one.
- A dedicated institute sells on the marketplace through a mirror listing on the shared platform, because the marketplace reads across institutes in one database.

### 6.5 Marketplace (1D)

**Buyers**

- **Keep**: browse recorded and live, institutes directory, search, one cart across institutes, discount codes, checkout, My library, invoices, clash notes on live seats.
- **New**: categories and exam tags (JEE, NEET, UPSC, board classes, skills); filters for language, level, price, rating, mode and city; paging.
- **New**: ratings and reviews from buyers only, moderated; questions to the seller.
- **New**: free preview lessons; fuller course pages with syllabus, outcomes and faculty; wishlist.
- **New**: refund requests under a stated policy (a time window and a watched limit); order history; buyer help requests.
- **New**: buyer's state collected at checkout so GST is split correctly.
- **New**: search-engine pages and sitemap; simple shelves (popular, new, similar). No AI claims.

**Sellers**

- **New**: seller-only sign-up: institute details, PAN, bank account, GST choice, seller agreement; document review; payout account created automatically.
- **New**: seller console: recorded courses with the video upload flow, listings, combos, codes, buyers, sales, earnings, payout statements with bank references, refunds and disputes, replies to reviews, storefront profile, a views to cart to purchase funnel.
- **New**: first listing is reviewed by Zinny before it goes live.
- **New**: tax papers: Zinny's commission invoices, tax deduction and collection statements.
- **Change**: selling a seat in a live batch needs a subscription; seller-only institutes sell recorded courses.
- **Keep**: listings for a course, a lecture, a live batch and combos; discount codes; pause, relist and remove.

**Zinny**

- **New**: commission rules: a default rate, per seller, per category, time-limited offers.
- **New**: split at payment, with the seller's share held until the refund window closes, then paid on a schedule.
- **New**: a ledger of every movement: sale, gateway fee, commission, GST on commission, tax deducted and collected, payout, reversal; matched daily against the gateway's settlements.
- **New**: refunds that also pull back the seller's share; disputes and chargebacks.
- **New**: seller review list; listing review list (extends today's content review); featured shelves and banners; Zinny-funded and seller-funded codes; basic fraud checks.
- **New**: marketplace figures: sales value, Zinny's share, top sellers, conversion.

### 6.6 Institute admin panel, shared by Direct and White label

**Keep as it is**: dashboard and today board; quick actions; users, departments, invitations, bulk import, custom roles; courses and the quick course flow; batches, seat limits, clash check, timetable, sections and plans, batch switching, enrolment requests; curriculum and progress; tests, question pool, proctoring, grading; assignments and polls; attendance register, thresholds and alerts; certificates; leaderboards; sales, invoices, categories, refunds, GST switch; reports and insights; notification settings; seats; documents; privacy.

**Change**

- The menu follows the plan: a seller-only institute sees the seller console, and sections switch on with the plan (1F).
- Dashboard "Needs you" gains Arrivals, failed website syncs, fees due and payout notices (1B, 1D).
- Settings gains: Plan and billing, Website connection, Brand and web address, Payment gateway, Student ID format, Custom fields, API and webhooks, Activity log for the institute's own admins (1A to 1F).
- The class meeting link becomes "Built-in classroom or outside link" per batch (1E).

**New: fees** (1G)

- Fee structure per course or batch; instalment plans with due dates; concessions and scholarships; late fees.
- Dues list, reminders, a pay link through the institute's own gateway, receipts.
- Credit notes; coupons for the institute's own courses.
- Fee reports: collected and outstanding by batch, by month and by source.

**New: admissions** (1G)

- Enquiries become a pipeline: new, contacted, follow-up due, admitted, lost, with an owner and reminders.
- Batch waitlist with automatic offers when a seat frees.

**New: community and marketing** (1G; named in the original requirements, never built)

- Batch discussion and doubt solving: students ask, faculty answer, answers can be pinned.
- Contact lists and broadcasts by email, SMS and WhatsApp, with opt-outs honoured.

**New: smaller gaps closed**

- Images in test questions (1G); two-step sign-in for staff (1I).
- Emails for a rejected document and for a trial about to end (1F).

### 6.7 Learner portal

- **Keep**: Today, timetable, courses, My learning, lessons, tests, assignments, polls, live join, certificates, XP and badges, invoices, updates, notification settings, profile and sessions, privacy rights, KYC.
- **Change**: wears the institute's brand on a white-label address; shows the institute's name and logo inside the Zinny shell otherwise (1A, 1C).
- **Change**: a student of several institutes on Zinny switches between them; a white-label student never sees a switcher (1A).
- **New**: first-visit welcome after arriving from an institute's site (6.1) (1B).
- **New**: fees due, pay and receipts (1G); student ID card (1B); join the built-in classroom and watch its recordings (1E); ask a doubt (1G).
- **New**: installable web app with web push, per brand (1C).
- **Parents, change**: sees attendance, test results, fees due and announcements, not only the timetable; can link to a child with a code from the institute (1G).

### 6.8 Money

There are four separate flows. Each has its own invoices, refunds and matching.

| Flow | Path | Invoice from | Stage |
|---|---|---|---|
| Student pays on the institute's own website | Outside Zinny; recorded from the site | The institute (by Zinny or by the site, set per connection) | 1B |
| Student pays on a white-label site, or pays fees due in the portal | The institute's gateway, connected in Zinny | The institute | 1C, 1G |
| Student buys on the marketplace | Zinny's gateway, split to the seller | The seller, with Zinny as the operator; Zinny invoices its commission | 1D |
| Institute pays Zinny | Zinny's gateway | Zinny | 1F |

- **New**: gateway accounts per institute with keys stored encrypted; test and live; a connection check; a webhook address per institute (1A core, 1C screens).
- **New**: orders carry where they came from (website, white-label site, portal, marketplace, desk) and can be marked as paid outside Zinny (1A).
- **Change**: place of supply uses the buyer's state, not always the institute's (1C).
- **Keep**: order and refund handling, GST invoice PDFs, manual invoices, categories, desk fees, hourly re-check of unsettled payments, the test gateway for development.

### 6.9 Live classroom (1E)

- **New**: a class opens inside Zinny from the timetable; each class gets its own room.
- **New**: teacher controls: start and end, waiting room, mute all, remove, co-teacher, record.
- **New**: video, audio, screen share, whiteboard, sharing a PDF or slides, moderated chat, raise hand, quick polls.
- **New**: attendance from real presence: join and leave times decide present, late or absent, and staff can correct.
- **New**: recordings saved, processed and attached to the class; published as a lesson automatically if the batch says so; retention period per institute; a recording notice to students.
- **New**: weak-network mode (audio only, lower quality); a connection test before class; a watch-only mode for very large batches.
- **New**: participant limits by plan; minutes counted per institute and billed as an add-on.
- **Keep**: outside link mode, the join window and late rule, register, lock and unlock, weekly alerts, attendance report.
- The video service sits behind one interface so it can be swapped. Choose after a one-week trial of LiveKit, 100ms and Zoom Video SDK on cost per minute, quality on Indian mobile networks, recording and mobile support.

### 6.10 Content and video (1E)

- **New**: uploads go straight to storage in resumable parts, replacing the 4 MB relay through the app.
- **New**: videos are converted for smooth streaming at several qualities; playback links are signed and expire.
- **New**: the viewer's name or ID floats over the video to deter screen recording; stronger copy protection on higher plans.
- **New**: captions, playback speed, a shared content library reused across courses, bulk upload, storage counted per institute.
- **Keep**: lesson types, drip rules, watched-range progress, PDF viewer, YouTube and Vimeo links.

### 6.11 Notifications

- **Change**: every template reads the brand (name, logo, colour, sender, links); the identity emails stop being Zinny-only (1C).
- **New**: sender domain and SMS registration per institute (1C); web and mobile push (1C, 2A); delivery and bounce receipts (1I).
- **New kinds**: arrival waiting, website sync failing, fee due, payout sent, seller review result, document rejected, trial ending, class recording ready.
- **Keep**: channels, quiet hours, preferences, unsubscribe, retries, delivery log, test send.

### 6.12 Zinny team panel (1F unless marked)

- **Keep**: overview, institutes, sign-ups and document review, plans, licences, seat packs, invoices, billing settings, users, support mode, sign in as, view as, activity log, content review, analytics, data console, team and roles, privacy and breach register, global search.
- **Change**: plans gain a type (Seller, Direct, White label, Dedicated), what each switches on, limits, a setup fee, charged-by-use items and a marketplace commission rate.
- **Change**: limits and modules are enforced. Over a cap: a warning, then a grace period, then adding is blocked. Lapsed licence: grace, then read-only, then paused.
- **New**: institutes pay Zinny online: pay links on invoices, automatic recurring payment, reminders with a pay button, credit notes, upgrades and downgrades with fair credit (the existing proposal in `docs/proposals/plan-upgrades.md`).
- **New**: institute list shows plan type, website connection state, web address state and payout state.
- **New**: Integration desk (1B); web address and brand list (1C); seller reviews, payouts, commission settings and shelves (1D); usage counters for classroom minutes, storage and messages (1E); dedicated installation list with version and health (1H).
- **New**: figures by channel: students by source, subscription income, marketplace sales, institutes moving between plans.
- **New**: feature switches per institute and staged releases.
- **Change**: the unused partner tables are removed.

### 6.13 Institute sign-up and lifecycle (1F)

- **Change**: sign-up starts with "How will you use Zinny?": sell on the marketplace, run my institute with my own website, or my own branded platform (this one books a call).
- **New**: seller sign-up path with bank details and seller agreement (1D).
- **Keep**: the four-step wizard, document upload and review, the 3-day trial, freeze, choose a plan, licence reminders, suspension.
- **New**: guided setup per plan type: connect your website (Direct), set your brand and address (White label), list your first course (Seller).

### 6.14 Privacy, security and compliance (across stages; sign-off in 1I)

- **Roles under the privacy law**: the institute is responsible for its own students in Direct and White label, with Zinny as processor; Zinny is responsible for marketplace learners. Contracts carry a data processing agreement and a clause that the institute's site collected consent before sending data.
- **New**: consent recorded at the first handoff visit; guardian flow for minors who arrive from a site; an erasure request also tells the institute's site.
- **New**: API safety: hashed keys, scopes, rate limits, signed webhooks, replay protection, idempotency, masked logs, every write logged under the connection's name.
- **New**: handoff sessions are limited to one institute, so a site that sends someone else's email can never open that person's wider Zinny account.
- **New**: tests that prove one set of accounts cannot see another, added to the existing tenant isolation tests.
- **New**: gateway keys encrypted with a managed key; per-address cookies; the security headers and the cross-site write check learn about institute addresses.
- **New**: an outside security test before launch.
- **Needs an accountant's sign-off** (1D): tax collected at source by a marketplace operator, tax deducted on seller payouts, who issues the student's invoice on a marketplace sale, unregistered sellers, e-invoicing limits.
- **Needs the gateway's confirmation** (1D): that split payments keep Zinny outside payment-aggregator licensing.
- **Keep**: consents, rights requests, retention, breach register, cookie notice, guardian consent.

## 7. Phase 2: mobile apps

**Shape**

- One Zinny app for Android and iOS, with a home that follows the person's role: learner, parent, teacher, admin, seller.
- Branded apps for white-label institutes built from the same code with the institute's name, icon, colours and address. Apple requires each to be published from the institute's own developer account.
- Built with React Native and Expo, sharing types and the API client with the web code.

**Learner and parent**

- Sign in with a code, a password or the handoff link from the institute's site; pick an institute where there are several.
- Today, timetable, join the built-in classroom in the app, lessons with protected video, downloads for offline viewing, PDFs.
- Tests with app-switch detection; assignments with camera scan upload; polls; doubts.
- Leaderboard, certificates with share, invoices, fees due, student ID card.
- Push notifications; profile, sessions and privacy rights including account deletion.
- Marketplace browse and library.
- Parent: child's attendance, results, fees and announcements.

**Staff**

- Today board; start and teach a live class; take attendance.
- Arrivals and join request approvals; add a student; record a fee; send an announcement.
- Grade short answers and assignments; timetable; find a student by scanning their ID card.
- Key figures; notifications. Sellers: sales and payouts at a glance.
- Heavy setup (course building, website builder, roles, brand) stays on the web.

**Behind the apps**

- The app API (started in 1A) completed for every screen above; token sign-in; device list; push delivery.
- Forced update and feature switches; crash and usage reporting.
- A build line that produces a branded app from an institute's settings and submits it to the stores.

**Store rules to settle before building**: Apple requires its own in-app purchase for digital content bought inside an iOS app. The plan assumes the iOS app gives access to what was bought on the web and sells nothing itself. This needs a policy review before 2B.

| Stage | Work |
|---|---|
| 2A | App API completion, design for small screens, sign-in, push |
| 2B | Learner and parent app |
| 2C | Staff app |
| 2D | Branded build line, store listings, beta, release |

