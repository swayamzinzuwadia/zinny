# website-builder handoff

## Built
**Admin, Website › Manage profile** (`/[uni]/admin/website/profile/…`)
- **Institute profile:** tagline, about, founded year, address, city, map link, phone, WhatsApp, enquiry email, six social links, logo and cover image, and the site colour. The colour is the university's branding colour unless you set one; a colour must reach 4.5:1 contrast on cream.
- **Website builder:** the home page as 12 ordered sections: hero, about, courses, faculty, testimonials, reviews, gallery, videos, blog highlights, team, enquiry form and contact. Each can be moved, shown or hidden, and edited. Changes save to a draft. You can preview the draft at `/site/[uni]/preview`, then publish it or discard your changes. Publishing replaces the live page. The courses section fills itself from published courses, with the next batch and seats left.
- **Faculty profiles:** admins approve a profile, send it back with a note, or hide it from the site.
- **My profile page:** faculty edit their own profile (photo, headline, bio and subjects; their courses come from their batches) and send it for approval. While changes wait, the approved version stays live.

**Admin, Website › Website sections:** an overview, then:
- testimonials and team, each ordered, shown or hidden;
- reviews: approve, hide or delete;
- gallery: upload several photos at once, add captions;
- videos: YouTube links;
- blog: a TipTap editor whose HTML is sanitised on save, with slug, cover image, excerpt, author, draft or published, and a preview;
- enquiries inbox: new, contacted and closed, an assignee, and notes with their history.

**Public site:** `/site/[uni]`, `/blog`, `/blog/page/[n]`, `/blog/[slug]`, `/courses/[courseId]` (open batches, timings and seats left; Enrol goes to `/[uni]/learn/courses/[id]`), `/faculty/[id]`, `/media/[id]`, `sitemap.xml` and `robots.txt`.
- Pages are statically rendered, cached with `unstable_cache` and refreshed on every change through `revalidateTag`. Time-based revalidation (60 s to 1 h) is the backstop.
- Metadata includes Open Graph and JSON-LD.
- Enquiry and review forms use a honeypot and rate limits: 5 an hour per sender and 200 per site. Only an HMAC of the sender's IP is stored.

**Uploads:** images are re-encoded to WebP with sharp; metadata is stripped and SVG is refused.

**Daily job:** removes unused images and old rate-limit rows.

**Report:** "Website enquiries".

**Dashboard cards:** "Website" for admins, and "Your public profile" for teaching staff.

**Seed:** a complete site for the Demo University. Images are drawn locally.

**Tests:** 61 tests in `tests/website-builder/`. A 41-check click-through is in `docs/handoff/website-builder/clickthrough.py`, and screenshots are in the same folder.

## Not built (and why)
- **Custom domains** are out of scope. They would need a `site_domains` table, middleware that rewrites `host` to `/site/[uni]`, TLS through Vercel domains, and a root `/robots.txt` per domain.
- **Drag-and-drop designer, SEO tooling and ads** are out of scope.

## Contracts used / provided
- **Emits:** `enquiry.received`. **Handles:** none.
- **Slots:** `dashboardCards`: `website` (700, `website.manage`) and `my-profile-page` (710, `self.profile`).
- **Reports:** `website-builder.enquiries`. **Jobs:** `website-builder.housekeeping` (daily).
- **Core API:** `withTenant`, `audit`, `emit`, `assertCan`, `can`, `systemActorFor`, `notify`, `peopleLite`, `universityLite`, `todayFor`, `storage`. Core tables are read only.
- **Allowed exception:** the public pages read with `systemActorFor`. They also use `universityBySlug` from `@/server/context`.

## New packages
`sanitize-html`, `@types/sanitize-html` (dev), `sharp` (already in the tree through next), `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`.

## New environment variables
`SITE_ORIGIN` and `SITE_FINGERPRINT_SECRET`. Both are optional; see `src/modules/website-builder/ENV.md`.

## Requests for other owners
- **Core:** reserve dashboard slot keys `website` (700) and `my-profile-page` (710) in contracts section 3.
- **Core:** faculty have no Website menu entry, so they reach "My profile page" only through the dashboard card. Consider adding a menu link for teaching roles.
- **Core:** the root `/robots.txt` should list each site's sitemap or point to `/site/<uni>/robots.txt`.
- **Integrator:** `next.config` needs no change. `next/image` serves `/site/<uni>/media/*` locally.

## Known issues
- A cached site is keyed by slug. If a university is recreated or its slug changes, the old data can show for up to 10 minutes, until revalidation.
- Videos are recommended public YouTube links, not the Demo University's own.
