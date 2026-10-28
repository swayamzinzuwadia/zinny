---
name: website-builder
description: Builds each university's public website on Zinny — profile, section-based page builder, blogs, gallery, testimonials, reviews, enquiries — plus the public site itself. Use for the Website section and public pages.
model: opus
effort: high
isolation: worktree
---

# Agent: website-builder

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- website-builder 3109`

**You own:** `src/modules/website-builder/`, `src/app/[uni]/admin/website/`, `src/app/site/`, `tests/website-builder/`. Table prefix `site_`.

**Permissions:** `website.manage`; faculty edit their own public profile through `self.profile`.

**PRD:** page 4 (Website: manage profile, website sections), page 8 (manage profile is the institute profile, my profile page and the website builder; website sections are testimonials, reviews, enquiries, gallery, videos, blogs, team), page 9 (each university has its own branding and website), page 10 (website builder in phase 2).

## Must have

1. **Manage profile:**
   - The institute profile: about, address, contact details, social links, logo and cover image through `storage()`.
   - "My profile page": public profiles for faculty (photo, bio, subjects, courses), which faculty edit for themselves and admins approve.
2. **Website builder.**
   - A home page made of ordered sections, each of which can be shown, hidden and edited: hero, about, courses, faculty, testimonials, reviews, gallery, videos, blog highlights, team, enquiry form, contact.
   - The courses section is filled automatically from published courses (core tables, read only).
   - Draft and published versions, with a preview of the draft. Publishing replaces the live page.
3. **Sections content:**
   - testimonials, team
   - reviews, with moderation: approve or hide
   - gallery, with image uploads
   - videos, as YouTube links
   - blogs: posts with a cover image, rich text (sanitised), slug, draft or published, and an author
   - enquiries: an inbox with new, contacted and closed statuses, an assignee and notes
4. **Public site** at `/site/[uni]`, `/site/[uni]/blog`, `/site/[uni]/blog/[slug]` and `/site/[uni]/courses/[courseId]`:
   - Course pages show open batches with timings and seats left (core read), and an Enrol button linking to `/[uni]/learn/courses/[id]`.
   - Use the university's branding inside the Zinny palette rules.
   - Fast: static rendering with revalidation on publish.
   - Proper metadata, Open Graph, `sitemap.xml` and `robots.txt` per site.
   - **Allowed exception:** public pages read published content with `withTenant(systemActorFor(universityId))` after resolving the slug. They never show drafts, hidden reviews or enquiries.
5. **Enquiry form:** honeypot plus rate limit. Saves the enquiry, emits `enquiry.received` and notifies admins.
6. **Seed:** a complete, good-looking site for the Demo University, with real-sounding copy, three blog posts, testimonials, gallery images (generate simple brand-coloured placeholder images rather than downloading photos), a team, and a few enquiries.

## Rules that need tests
- Drafts never appear on the public site.
- One university's site never shows another's content, even with a crafted course id.
- The enquiry form rejects the honeypot and rate-limits.
- Only `website.manage` holders edit the site; faculty edit only their own profile.
- Blog HTML is sanitised.

## Out of scope
Custom domains (note what would be needed in the handoff), a free-form drag-and-drop page designer, SEO tooling beyond metadata and sitemaps, and online ads.

## Contracts
- **Uses:** core API (`universityLite`, `getCourseLite`, `listCourseBatches`, `peopleLite`, `notify`, `storage`, `systemActorFor`), core tables read only, `emit`.
- **Provides:** event `enquiry.received`, the public site routes and the Website admin section.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/website-builder.md`.
