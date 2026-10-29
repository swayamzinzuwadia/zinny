# certificates handoff

Branch `agent/certificates`, from `foundation-v1`. Screenshots are in `docs/handoff/certificates/` (desktop; learner and verify screens also at 390 px; HOD course tab at tablet width).

## Built

**Templates** (`/[uni]/admin/products/certificates`, `/templates/[id]`)
- Every university starts with three A4 landscape designs: Classic (the default), Modern and Minimal. They are created the first time certificates are used (race-safe, with an advisory lock).
- Each certificate carries:
  - the university's name, logo (`branding.logoUrl` as https, data: or a `public/` path; PNG or JPEG) and brand colour; with no usable logo it shows a monogram;
  - the student name, course title and completion date;
  - the certificate code, a QR code linking to the verify page, and "valid until" when the certificate expires;
  - up to two signatories (name, title, signature image).
- Staff can edit the heading and both lines of wording.
- The live preview uses the same layout code as the PDF, rendered to SVG with the same fonts and metrics. It redraws 300 ms after each change, and you can try a long student name or course title.
- Staff can download a sample PDF.
- Other template actions: add a template, make it the default, archive it (refused for the default and for templates in use) and restore it.
- Signature uploads must be PNG or JPEG of 500 KB or less. The type is checked from the file's bytes. Earlier images are kept, because issued certificates may still print them.
- Changing templates needs `cert.manage` at university level (Institute Admin). HODs, faculty and the board can view them.

**Rules per course** (`adminCourseTabs.certificates`)
- Each course has a template, an "issue automatically" setting, validity in months (empty means it never expires) and a reminder N days before expiry. All values are validated.
- A course without a rule uses the default template, issues automatically and never expires.
- Nothing is issued while the course's `certificateEnabled` is off, either automatically or by hand.

**Issuing**
- Handler `certificates.issue-on-completion` on `enrolment.completed`. It checks for an existing certificate first. A partial unique index settles races (one first certificate per enrolment), and `source_event_id` is unique.
- The PDF is rendered once and stored at `<uni>/certificates/issued/<id>/certificate-<code>.pdf` with its SHA-256. It is never regenerated.
- The template's wording, signatures and colour are frozen onto each certificate, so later edits don't change certificates already issued.
- Each issue emits `certificate.issued`, notifies the student and is audited.
- Manual issue (`cert.issue`) needs a reason and takes a completion date. The same action handles renewal (once a certificate has expired, or within 90 days of expiry or the reminder window if longer) and re-issue after a revoke. Each new certificate links to the one it replaces (`replaces_id`).
- Revoke (`cert.issue`) needs a reason. The student is told the certificate was revoked but not the reason.

**Verify page** (`/verify`, `/verify/[code]`, public)
- It shows exactly the student name, course, institute, issue date and status (valid, expired or revoked), plus the code the visitor entered.
- It finds certificates by exact code only, accepting lower case, spaces and hyphens, and reading O as 0 and I or L as 1 (Crockford base32).
- `systemDb()` appears only in `service/verify.ts`, and only to select `university_id` by code. Everything else is read under RLS as that university's system actor.
- Expired status is worked out from `valid_until`, so it is correct before the daily job runs.
- Each visitor (by IP) gets 30 look-ups and 10 codes that don't exist per 10 minutes.
- Pages are marked `noindex` and sent with `no-referrer`.

**Learner side**
- `/[uni]/learn/certificates` shows each certificate drawn on screen, its status and dates, a PDF download and a share link. The share link copies, or opens the share sheet on phones.
- Slots `learnerCourseTabs.certificate` (the certificate, or what to expect) and `learnerHubSections.certificates`.
- Alumni keep full access (tested through `graduate`).

**Staff side**
- The course tab shows counts, the issued list (scoped with `reach`: faculty see their own batches), rules and issue by hand.
- `/admin/products/certificates` also lists and searches issued certificates. `/issued/[id]` shows one certificate with its details, history and a revoke form.
- Downloads go through routes that check permission and redirect to a 5-minute signed link.
- `dashboardCards.certificates-issued` shows this month's count (automatic and manual), last month's count, and how many expire in the next 30 days.

**Expiry job** `certificates.expiry` (daily)
- Sends one renewal reminder per certificate (`certificate.expiring`).
- Marks certificates past their last valid day as expired and notifies the student (`certificate.expired`).
- Skips certificates that have already been renewed. Overlapping runs are safe.

**Seed**
- The three templates, signed by Asha Admin with Hema or Mehul, using signatures generated locally.
- A rule for each of the four courses.
- Diya's Python Basics completed through `markEnrolmentCompleted`, which makes the handler issue her certificate.
- One certificate issued to Kabir by hand and then revoked.
- Demo: sign in as `diya@demo.edu` to see a certificate as a learner.

**Tests:** 58 in `tests/certificates/`. Full suite: 207 passed.

## Not built (and why)
- Open badges, LinkedIn auto-posting and a drag-and-drop designer are out of scope.
- I did not build a separate logo upload per template; certificates use the university's branding logo. SVG logos can't be embedded in the PDF, so they fall back to the monogram.
- Non-Latin scripts in names (for example Devanagari) are not drawn. The fonts cover Latin, including extended Latin, and characters they lack are left out. A Noto fallback font would fix this.
- I did not run `npm run build`, as instructed. The pages, the PDF and the fonts all worked under `next dev`.

## Contracts used / provided
- **Handles:** `enrolment.completed` (skips platform events).
- **Emits:** `certificate.issued` `{ certificateId, userId, courseId, code }`. `code` is the 12-character stored form without hyphens; it is displayed as `XXXX-XXXX-XXXX`.
- **Slots:** `adminCourseTabs.certificates` (500, `cert.view`), `learnerCourseTabs.certificate` (500, `self.view_certificates`), `learnerHubSections.certificates` (500, `self.view_certificates`), `dashboardCards.certificates-issued` (500, `cert.view`).
- **Job:** `certificates.expiry`, daily.
- **Core API:** `withTenant`, `audit`, `emit`, `assertCan`/`can`/`reach`, `universityLite`, `todayFor`, `peopleLite`, `getCourseLite`, `courseTarget`, `listCourseBatches`, `enrolmentById`, `notify`, `storage`, `systemActorFor`, and `markEnrolmentCompleted` (seed only). Reads core `enrolments` with `select` only, to list candidates for manual issue and to check a learner's own enrolment.
- **Notification kinds:** `certificate.issued`, `certificate.revoked`, `certificate.expiring`, `certificate.expired`. Their `data` holds `certificateId`, `courseId`, `code` and `path`, the learner certificates page.
- **Routes:** `/verify`, `/verify/[code]`, `/verify/fonts/[file]`, `/[uni]/learn/certificates`, `/[uni]/learn/certificates/[id]/download`, and the admin routes under `/[uni]/admin/products/certificates/`.

## New packages
`pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1, `qrcode` 1.5.4, `@expo-google-fonts/lexend` 0.4.1, `@expo-google-fonts/libre-baskerville` 0.4.3 (OFL fonts, read from `node_modules` at run time); dev: `@types/qrcode` 1.5.6.

## New environment variables
- `CERTIFICATE_VERIFY_BASE_URL` (see `src/modules/certificates/ENV.md`). It is required in production, because every PDF prints it permanently, and issuing refuses to run without it.
- Dev and `ZINNY_DEMO=1` fall back to `http://localhost:$PORT`.

## Requests for other owners
1. **Integrator (`src/server/authz/menu.ts`):** add "Certificates" (`/products/certificates`) to the Products menu. Today it is reached from the course tab and the dashboard card.
2. **Integrator (learner nav, `src/app/[uni]/learn/nav.tsx`):** optionally add a Certificates link. Today it is reached from My learning and each course's Certificate tab.
3. **Integrator (deployment):** set `CERTIFICATE_VERIFY_BASE_URL` and add it to `.env.example`. If a deploy reports a missing `.ttf`, add the font globs from ENV.md to `outputFileTracingIncludes`.
4. **Core:** a shared rate-limit store for public routes, such as a small Postgres table usable without a tenant. The verify page's limit is per server instance.
5. **notifications-delivery:** templates for the four certificate kinds.
6. **content-progress:** nothing is required. Note that my seed completes `diya@demo.edu / Python Basics`.

## Known issues
- The rate limit is held in memory per instance (request 4). Codes carry 60 random bits, so guessing them is not practical anyway.
- The logo is fetched when a certificate is issued, inside the handler's transaction (4 s timeout, cached for 10 minutes).
- Month arithmetic: 12 months from 12 Oct 2026 is valid until 11 Oct 2027; 1 month from 31 Jan is valid until 27 Feb.
- Browser checks passed for: issue by hand, staff download, revoke, rules (save and the validation message), signature upload, template save, sample PDF, verify (revoked status, no reason shown, the code form) and learner download (own: yes; someone else's: 404). This container's OOM killer stopped Chromium several times, so the checks ran in small steps.
