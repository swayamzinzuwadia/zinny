# Zinny v2 agent team and build cycle

## The agent team and how it builds

The repository already builds this way: briefs in `.claude/agents/*.md` (with `model`, `effort` and `isolation: worktree` in the header), exclusive paths in `docs/plan/ownership.json`, shared rules in `docs/plan/contracts.md`, one database and port per agent from `npm run agent:setup`, and a handoff file per agent. v2 keeps the method and repairs it first (5.9).

### 13.1 The roster

**Lead and standing agents** (run in every stage)

| Agent | Job | Model and effort |
|---|---|---|
| lead (the main session) | Holds the plan, writes and updates briefs, starts agents, approves each agent's plan, reports to you | most capable, high |
| explorer (built-in Explore) | Read-only searches and the code graph; never edits | fast model |
| architect (built-in Plan) | Designs a stage before anyone builds; challenges the approach | most capable, high |
| reviewer | A fresh read of each finished branch with the code-review skill; it gets the diff, not the builder's opinion | opus, high |
| security-reviewer | The security-review skill on anything touching accounts, money, keys, addresses or the API | most capable, high |
| qa-clickthrough | Runs the app, clicks the real flows with Playwright, saves screenshots at desktop and 390 px | sonnet, medium |
| integrator (exists, updated) | Merges a wave, generates the one migration, runs every test and the cross-module flows, tags the release | opus, high |
| docs-writer | Turns handoffs into the feature reference, the developer site and change notes | sonnet, medium |

**Stage 1A: one agent, alone, in seven ordered steps.** `v2-foundation` (replaces `foundation-lock`), most capable model, high effort. Each step ends with green tests, a reviewer pass and a commit before the next starts.

| Step | Work | Main files |
|---|---|---|
| 1 | Repairs from 5.9: rules, ownership, import boundaries, job schedules | `CLAUDE.md`, `docs/plan/*`, `eslint.config.mjs`, `vercel.json`, `scripts/check-ownership.ts` |
| 2 | Schema and database rules for 5.1 to 5.8 | `src/db/schema.ts`, `src/db/policies.sql` |
| 3 | Address lookup and rewrite | `src/proxy.ts`, `src/server/site/`, `src/server/security/*`, `src/server/context.ts` |
| 4 | Account sets and sessions | `src/server/auth/session.ts`, `src/server/actor.ts`, `src/modules/identity/auth.ts` |
| 5 | Brand source and colour variables | `src/server/brand/`, `src/components/ui.tsx`, `src/app/globals.css` |
| 6 | Gateway per institute, key encryption, student record, external orders | `src/server/payments/gateway.ts`, `src/server/security/secrets.ts`, `src/server/services/students.ts`, `enrolment.ts` |
| 7 | API kit, `apiRoutes` slot, entitlements, layout slots, new events and permissions; tag `v2-foundation` | `src/server/api/`, `src/contracts/*`, `src/server/registry.ts`, `src/server/authz/menu.ts` |

**Wave 1: parallel, each in its own worktree and database**

| Agent | New or existing | Owns | Must deliver |
|---|---|---|---|
| connect | new, `conn_` | `src/modules/connect/`, admin Settings "Website connection", Arrivals | Student and order endpoints, product mapping, placement rules, handoff links, outgoing webhooks, sync monitor, sandbox institute |
| identity | existing | `src/modules/identity/`, sign-in routes | Sign-in per account set, handoff sessions, first-visit flow, scope checks on profile, credential tools, app tokens |
| students | new, core screens | student pages under admin Users | Student ID format, ID cards, source filters, timeline, merge duplicates |
| domains | new, `dom_` | `src/modules/domains/`, Settings "Web address" | Add and verify addresses, certificates, redirects, neutral fallback |
| branding | new, `brand_` | `src/modules/branding/`, Settings "Brand" | Brand studio, assets, email domain setup, live previews |
| payments | existing | `src/modules/payments/` | Institute gateway accounts, per-account webhooks, paid checkout for an institute's own students, buyer state |
| notifications-delivery | existing | its module | Brand-aware templates, per-institute sender, new message kinds |
| zinny-team-panel | existing | `/platform`, its module | New plan types, entitlements provider, Integration desk, limits enforced |
| onboarding | existing, brief added | its module | "How will you use Zinny?" start, online payment to Zinny, missing emails |
| wording sweep | ten runs, one per existing module | that module only | Convert its links to `links()` and its Zinny wording to `brand()`; mechanical, on a cheaper model |

**Wave 2: parallel**

| Agent | Owns | Must deliver |
|---|---|---|
| connect-wordpress | `integrations/wordpress/` (outside `src/`) | Plugin: sign-ups, WooCommerce orders, "Go to my classes" button, catalogue block; then the gateway listener in `connect` |
| marketplace | its module, brief added | Seller-only sign-up, seller console, categories, reviews, refund requests, storefront |
| payments (second run) | its module | Split payments, ledger, payouts, refund reversal, daily match with settlements |
| classroom | new, `room_` | Built-in classroom behind one provider interface, presence attendance, recording to lesson, minutes counter |
| content-progress | its module | Direct resumable uploads, streaming conversion, signed playback, watermark |
| website-builder | its module | Extra pages, menu, SEO, consent-gated tags, root sitemap at the institute's address |
| developer-docs | `docs-site/` | Guides, API reference from the OpenAPI file, samples |
| app-api | new, `app_` | Screen data functions, devices, push channel |

**Wave 3: parallel**

| Agent | Must deliver |
|---|---|
| fees (new, `fee_`) | Fee structures, instalments, dues, pay links, credit notes, fee reports |
| admissions (in website-builder and students) | Enquiry pipeline, waitlist |
| community (new, `comm_`) | Batch discussion and doubts |
| marketing (new, `mktg_`) | Contact lists and broadcasts |
| parents (in learner routes) | Attendance, results, fees, link by code |
| dedicated | Single-institute mode, licence link, support tokens, move tool |
| launch | Load test, outside security test fixes, migration of today's institutes |

**Phase 2**

| Agent | Must deliver |
|---|---|
| mobile-foundation | Expo project, sign-in, navigation by role, design tokens shared with web, push, forced update |
| mobile-learner | Every learner and parent screen in section 7 |
| mobile-staff | Every staff screen in section 7 |
| mobile-release | Branded build line from an institute's settings, store listings, beta, submission |

### 13.2 The cycle every building agent follows

1. **Brief.** The lead writes `.claude/agents/<name>.md`: what it owns, table prefix, must-haves, contracts it uses, tests required, done checklist.
2. **Plan.** The agent starts in plan mode, reads `CLAUDE.md` and the contracts, asks the code graph, and proposes its approach. The lead approves or corrects it. No code before this.
3. **Build.** In its own worktree, database and port. Services first, then pages, then tests.
4. **Self-check.** `npm run typecheck`, `lint`, `test`, `check:ownership`; isolation test per new table; allow and deny test per permission.
5. **See it work.** qa-clickthrough runs the flow in a browser and saves screenshots.
6. **Independent review.** reviewer on the diff; security-reviewer where accounts, money, keys or the API are touched. Findings go back to the builder.
7. **Handoff.** `docs/handoff/<agent>.md` with what was built, what was not, contracts used, new packages, requests for other owners.
8. **Integrate.** At the end of the wave the integrator merges, generates the migration, runs cross-module flows and tags.
9. **Your gate.** A short demo and checklist per stage. The next stage starts on your word.

### 13.3 Which Claude Code feature does which job

| Feature | Used for |
|---|---|
| Plan mode | Before every stage and before each agent builds |
| Agent briefs with `model` and `effort` | One per module; the hardest work (foundation, accounts, money, security, integration) on the most capable model at high effort, standard modules on opus, mechanical sweeps and docs on a cheaper model |
| Worktree isolation | Every building agent, so no two touch the same checkout |
| Cloud sessions in parallel | One session and branch per wave agent, each opening a pull request the lead watches |
| Workflows (scripted multi-agent runs) | The fan-outs: the wording sweep across ten modules, and the review-then-verify pass on every branch of a wave. Started only when you ask for one |
| Built-in Explore and Plan agents | Read-only search and stage design |
| Skills | `card-to-page-ui` (exists) for motion; code-review, security-review, simplify and run; new project skills written in 1A: add a module, add an API endpoint, use the brand layer, write an isolation test |
| Hooks in `.claude/settings.json` | Refuse an edit outside the agent's owned paths; run `check:ownership` before an agent stops; set up the database when a cloud session starts |
| Scheduled tasks | Nightly full test run and Zinny-wording count on the integration branch; weekly dependency and security scan; results reported to you |
| Pull request watching | Each agent fixes its own failing checks and review comments |
| `CLAUDE.md` and handoff files | The shared memory between agents and between sessions |

