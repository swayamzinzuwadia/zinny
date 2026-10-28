# Zinny build plan: parallel agents

## The idea

Twelve Claude Code agents build Zinny at the same time, each in its own git worktree, without waiting on each other. Three things make that possible:

1. **Exclusive ownership.** Every file, route and table has exactly one owner (`ownership.json`). No two agents ever edit the same file, so merges don't conflict.
2. **Frozen contracts.** Modules never call each other. They react to events, plug into slots on core pages, and use one stable core API (`contracts.md`). All of these exist before the agents start.
3. **Own database per agent.** Each worktree gets its own dev and test database and its own port, so agents never break each other's data or tests.

The one thing that can't be parallel is creating those contracts. So the plan has one short step before and one after:

```
Step 1  foundation-lock   (alone)   turn the current code into a contract-first base, tag foundation-v1
Step 2  12 module agents  (parallel) each builds its module from foundation-v1, on its own branch
Step 3  integrator        (alone)   merge, one migration, cross-module tests, tag wave1
```

## Roster

| Agent | Builds | PRD | Port |
|---|---|---|---|
| foundation-lock | Contracts, events, slots, registry, per-agent setup, ownership check | p. 9 rules | — |
| identity | Invites, password reset, phone OTP, sign-in protection, profile, sessions | p. 9 | 3111 |
| notifications-delivery | Email, SMS and WhatsApp delivery, templates, preferences | — | 3110 |
| payments | Razorpay checkout and webhooks, refunds, GST invoice PDFs, Sales page | p. 8–9 | 3106 |
| content-progress | Curriculum editor, lesson player, progress, course completion | p. 5, 7 | 3104 |
| assessments | Question pool, tests and series, proctoring, taking tests, grading | p. 4, 7 | 3101 |
| live-classes | Join links, attendance register, attendance %, alerts | p. 5–7 | 3102 |
| assignments-polls | Assignments with files, grading, polls | p. 7 | 3103 |
| certificates | Templates, auto-issue on completion, renewals, verify page | p. 7 | 3105 |
| gamification | XP rules, badges, challenges, leaderboards (from events only) | p. 8 | 3108 |
| reports-board | One-page Reports with CSV/XLSX, Insights for Board/Owner | p. 3, 8 | 3107 |
| website-builder | Institute profile, section builder, blogs, enquiries, public site | p. 8 | 3109 |
| zinny-team-panel | Universities, licences, support tooling, content review, partners, Zinny billing, analytics | p. 2, 9 | 3112 |
| integrator | Merge, migration, cross-module tests, release | — | — |

All twelve module agents depend only on `foundation-v1`. Run them in any order or combination.

## What is already built

The current code (in the repo you start from) already covers:
- roles and scope, and universities kept separate by the database
- departments and CSV import, with alumni and parents
- courses and batches, with seat holds and the clash check
- batch switching with HOD approval, and the automatic timetable
- GST invoices and the mock payment gateway
- support mode, the redesigned admin panel and learner app, and demo data matching the PRD examples

That is PRD phase 1 apart from tests, live classes and real payments, which this wave adds.

## How to run it

**Once, on your machine:**

```bash
# Postgres 16 (Docker is simplest)
docker run -d --name zinny-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
# The repo, with this kit's files at its root (CLAUDE.md, .claude/agents/, docs/plan/, docs/prd/)
cd zinny && git add -A && git commit -m "Add agent kit" && git push
```

**Step 1: foundation (one terminal).**

```bash
claude
> You are the foundation-lock agent. Read .claude/agents/foundation-lock.md and follow it exactly.
```

Check its handoff, then confirm `main` is pushed and tagged `foundation-v1`.

**Step 2: module agents (one terminal each).**

```bash
claude --worktree assessments
> You are the assessments agent. Read .claude/agents/assessments.md and follow it exactly. Start with the setup line.
```

Repeat with each agent's name in a new terminal. Each one gets its own folder under `.claude/worktrees/` and its own branch (`worktree-<name>`), branched from the pushed `main`.

How many at once: 4–6 is comfortable on a laptop. Each needs its own `npm install`, dev database and dev server. A good first batch is identity, notifications-delivery, payments, content-progress, assessments and live-classes; the second batch is the other six. Order between batches doesn't matter.

You can also run them as subagents from one session, because each agent file has `isolation: worktree`. For work this long, separate sessions are easier to watch and resume.

**Step 3: integration (one terminal, after the agents finish).**

```bash
claude
> You are the integrator agent. Read .claude/agents/integrator.md and follow it exactly.
```

## What you check

- **After foundation:** that the contracts read sensibly to you (`contracts.md`), and that the app still works as before.
- **During the wave:** each agent's screenshots in `docs/handoff/<agent>/` and its handoff note. Give feedback in that agent's own terminal only.
- **After integration:** the integration report, especially "decisions needed from Swayam", then click through the demo accounts.

## Rules that keep it parallel (agents enforce these)

- An agent that needs something outside its ownership writes a request in its handoff; it doesn't edit the file. The integrator handles requests.
- No agent generates migrations; the integrator generates one per wave.
- `npm run check:ownership` must pass on every branch before merge.

## Next wave (not in this plan)

Coupons and bundles; subscriptions, wallets, referrals and affiliates; offline fee receipts; Marketing (contacts, campaigns); Community; Settings and legal documents; Categories & utilities; custom domains; staff two-factor authentication; Zoom and Meet integration; then phase 3, the marketplace. The same pattern applies: a short foundation step for any new contracts, then parallel agents.
