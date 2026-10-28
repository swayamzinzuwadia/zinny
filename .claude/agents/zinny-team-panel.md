---
name: zinny-team-panel
description: Builds the Zinny team's own panel — universities and licences, support mode tooling, content review, partners, Zinny's billing to universities, platform analytics and team roles. Use for anything under /platform.
model: opus
effort: high
isolation: worktree
---

# Agent: zinny-team-panel

Read `CLAUDE.md` and `docs/plan/contracts.md` first; they override anything here. Branch from tag `foundation-v1`.

**Setup:** `npm install && npm run agent:setup -- zinny-team-panel 3112`

**You own:** `src/modules/zinny-team-panel/`, `src/app/platform/` (the current page moves to you), `tests/zinny-team-panel/`. Table prefix `plat_`.

**Permissions:** the `platform.*` actions in contracts.md section 9, checked with `assertPlatform`.

**Allowed exceptions:**
- The Zinny team works outside any one university, so your services may use `systemDb()`, always after `assertPlatform(actor, <action>)`.
- You may read any core table across universities.
- You change university data only through the core API (`createUniversity`, `updateUniversity`, `grantPlatformRole`, `revokePlatformRole`, support mode). You never act inside a university except through support mode.

**PRD:**
- page 2: the Zinny team is a separate super-admin panel with Super Admin, Account Manager, Content QA, Finance Admin, Partnerships and Support Agent; it creates, licenses and supports each university.
- page 9: the Zinny team only enters a university's space through support mode, and every support-mode action is logged with who, what and when.
- page 10: built alongside phase 1, starting with Super Admin and Support Agent.

## Must have

1. **Shell.** A `/platform` layout matching the admin panel's design (dark green sidebar, gold marker), showing only the sections the person's platform roles allow.
2. **Universities** (`platform.manage_universities`):
   - List with status, students, staff, plan and renewal date. Create a university (core `createUniversity`, which invites its admin).
   - Edit basics (core `updateUniversity`): name, web address, time zone, GSTIN, legal name, state, invoice prefix.
   - Suspend or reactivate.
3. **Licences** (`platform.licences`):
   - Plan (Pilot, Standard, Enterprise), student cap, staff cap, modules switched on, start and end date.
   - Usage against caps (cross-university counts).
   - Warnings at 90% of a cap and 30 days before the end date, shown as alerts on the platform home (your own `plat_alerts` table; core notifications belong to universities).
4. **Support** (`platform.support_mode`):
   - Enter support mode with a reason (already in core) and see who is in which university right now.
   - Force-end a session.
   - A full log browser filtered by university, person, action and date, which can be exported.
5. **Content review** (`platform.content_review`): a queue of newly published courses across universities with read-only previews. Content QA can flag issues with notes, and Account Managers can see the flags. No edits to university content.
6. **Partners** (`platform.partners`): sponsors and corporate partners for the future marketplace, with contacts, status and notes.
7. **Zinny billing** (`platform.finance`): Zinny's own invoices to universities for their licences (number, period, amount, GST, status paid or unpaid, due date). These are separate from the universities' own student invoices.
8. **Analytics** (`platform.view_analytics`): universities, active students, enrolments per week, and money collected by universities per month, overall and per university.
9. **Team** (Super Admin): invite Zinny team members and give or remove platform roles (core `grantPlatformRole` and `revokePlatformRole`; invites go out through `user.invited`).
10. **Seed:** licences for the Demo University and one more university, a few partners, Zinny invoices, and a content-review flag.

## Rules that need tests
- Every section refuses people without its `platform.*` action (Support Agent can't open billing; Content QA can't enter support mode).
- No platform action writes into university tables except through the core API.
- Support-mode entries and exits are always logged.
- Usage counts are correct across two universities.

## Out of scope
The marketplace itself (phase 3), automated licence payment collection, and impersonating a user. Support mode acts as the Zinny team member, never as someone else.

## Contracts
- **Uses:** the core API platform functions, `assertPlatform` and `canPlatform`, `user.invited` through core, and core tables read only.
- **Provides:** the complete `/platform` panel.

## Done
Follow the definition of done in `CLAUDE.md`, then write `docs/handoff/zinny-team-panel.md`.
