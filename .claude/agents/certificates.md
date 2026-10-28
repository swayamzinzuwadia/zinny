---
name: certificates
description: Builds Zinny certificates — templates, automatic issuing on course completion, renewal rules, PDF certificates and a public verification page. Use for anything about certificates.
model: opus
effort: high
isolation: worktree
---

# Agent: certificates

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- certificates 3105`

**You own:** `src/modules/certificates/`, `src/app/[uni]/admin/products/certificates/`, `src/app/[uni]/learn/certificates/`, `src/app/verify/`, `tests/certificates/`. Table prefix `cert_`.

**Permissions:** `cert.manage`, `cert.issue`, `cert.view` for staff; `self.view_certificates` for learners.

**PRD:** page 4 (courses with certificates), page 7 ("Certificates are issued on completion, with templates and renewal rules"; alumni keep certificates), page 8 (learner views certificates).

## Must have

1. **Templates** per university:
   - Three designs to start, all A4 landscape, using the university's logo and name.
   - Fields: student name, course title, completion date, certificate code, up to two signatories (name, title, signature image), and a QR code linking to the verify page.
   - A live preview.
2. **Rules per course:**
   - Which template to use.
   - Issue automatically on completion, only when the core course's `certificateEnabled` is on.
   - Validity in months (empty means it never expires).
   - Reminder N days before expiry.
3. **Automatic issuing.** Handle `enrolment.completed`, at most one certificate per enrolment, so the handler must be idempotent. Generate the PDF once, store it through `storage()`, and keep it unchanged afterwards. Notify the student.
4. **Manual issue and revoke** (`cert.issue`), with a required reason. Revoked certificates show as revoked on the verify page.
5. **Public verify page** `/verify/[code]`:
   - No sign-in. Shows the student name, course, institute, issue date and status (valid, expired or revoked).
   - Rate-limited, and shows nothing else.
   - **Allowed exception:** this route may look up one certificate by code with `systemDb()` (select only, minimal columns) to find its university, because the visitor has no tenant.
6. **Learner side:**
   - `/[uni]/learn/certificates`: list, download PDF, copy share link.
   - Slots `learnerHubSections.certificates` and `learnerCourseTabs.certificate`.
   - Alumni keep full access.
7. **Staff side:**
   - The `adminCourseTabs.certificates` tab: rules plus issued certificates for the course.
   - Templates under `/admin/products/certificates`.
   - `dashboardCards.certificates-issued`: this month's count.
8. **Expiry.** A daily job sends renewal reminders and marks expired certificates.
9. **Events.** Emit `certificate.issued`.
10. **Seed:** the three templates, rules for each seeded course, and certificates for the students the content-progress seed completes. Your seed may emit `enrolment.completed` through core `markEnrolmentCompleted` for one seeded enrolment, so the flow runs on your branch without content-progress.

## Rules that need tests
- The same `enrolment.completed` delivered twice yields one certificate.
- A course with certificates turned off issues none.
- The verify page reveals no more than the listed fields and works across universities only by exact code.
- Only `cert.issue` holders can issue or revoke.
- An expired certificate shows as expired.

## Out of scope
Blockchain or open-badge exports, LinkedIn auto-posting (a share link is enough), and a visual drag-and-drop template designer.

## Contracts
- **Uses:** event `enrolment.completed`; core API (`getCourseLite`, `enrolmentById`, `peopleLite`, `universityLite`, `markEnrolmentCompleted` in the seed only, `notify`, `storage`); slots; jobs.
- **Provides:** event `certificate.issued`, the `/verify` route, and the slots above.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/certificates.md`.
