# landing handoff

## Built
- Marquee (Finale) now runs at one steady speed; the scroll-velocity `rush` and its ScrollTrigger are gone. No other marquee exists.
- GST wording: optional per institute everywhere (Hero, Film, Loop, India, Learners, Finale marquee, Desk card). India now says each institute chooses at onboarding whether GST applies.
- "Built for phones" is now "Built for mobiles".
- Learners: "recorded classes" is highlighted in gold, semibold.
- Chalkboard section: one flat `brand-deep` token (ruled lines, lighter radial patch, gold sweep line and the hard-coded `#04291f` removed). Film colours are read from the tokens.
- Stuck labels fixed. Cause 1: the "Keep scrolling" cue was animated by two timelines, so it came back after the intro finished. It is now split into an outer element (film) and inner element (intro). Cause 2: the paragraph in the sale scene was visible under "You taught it once"; it now fades in with the sale scene.
- Film restructured: old way heading (WhatsApp, spreadsheets, paper), then "Now," then the scraps fly into the cards. Cards rewritten in plain words (Desk.tsx). Each card has its own accent (tokens and token mixes), fills from the bottom, lifts and tilts on hover; reduced motion turns the transitions off.
- Finale doors rewritten (Teach once. Earn for years. / Learn a skill, fast.) and mention an AI-enabled marketplace; Hero and the new section do too.
- Features replaced by `Audiences.tsx` ("Who uses Zinny, and how"): six personas, how they use it, what they get, an illustrated preview each, and a callout on learning a skill quickly. Nav link now points to `/#who-uses`.
- Nav already had Sign up (`/signup`). Footer has "Privacy notice" (`/privacy`) and "Grievance officer" (`/privacy#grievance`).

## Not built (and why)
- No `tests/marketing/` tests: the changes are copy and scroll animation, and there was no existing marketing test folder.
- Card descriptions are hidden on phones (cards are too narrow); only the card name shows at 390 px.

## Contracts used / provided
None.

## New packages
None.

## New environment variables
None.

## Requests for other owners
- `/signup`, `/privacy` and `/privacy#grievance` pages are built by other agents; links are in place.

## Known issues
- The dev server needed `--webpack` in this worktree because `node_modules` is a symlink (Turbopack refuses it). Not a code issue.
- "once" strike-through and big beat text are unchanged from before.
