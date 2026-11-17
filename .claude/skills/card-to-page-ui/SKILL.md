---
name: card-to-page-ui
description: Card-to-page motion for web UIs. A tapped card grows smoothly into the page it opens and shrinks back into its exact spot on the way back; filtered card grids glide into place; menus and panels open from the button that triggered them. Use whenever building or restyling a list of cards, tiles or rows that open a detail page, a dashboard or admin grid (tables, records, products, courses), a gallery, or when the user mentions hard cuts, page transitions, shared-element or morph animations, "animate from where it came", view transitions, or says navigation feels abrupt or users lose their place. Works best in Next.js App Router or any React 19.2+ app; also covers plain-browser fallbacks.
---

# Card to page UI

**The rule:** nothing on screen appears from nowhere. Everything animates from where it came from, so people never lose their place.

- **Cards grow into pages.** A tapped card grows into the page it opens, and the page shrinks back into the same card, in the same spot, on the way back.
- **Menus open from their trigger.** Menus, popovers and panels grow outward from the button that opened them, and fold back into it.
- **Lists move, they don't jump.** When a list is filtered or reordered, items glide to their new places; items leaving or arriving scale and fade.
- **Reduced motion is respected.** With `prefers-reduced-motion`, changes happen instantly.

The motion is built on the browser's View Transitions API through React's `<ViewTransition>`. Browsers without support just navigate instantly, and nothing breaks.

## Files in this skill

- `templates/motion.tsx`: the client components (`PageMotion`, `Morph`, `Swap`, `IntentLink`, `BackTo`, `RevealWhen`).
- `templates/motion-names.ts`: name helpers and transition types. This is a plain module, so server components can call it.
- `templates/motion.css`: every animation, including the reduced-motion rule.
- `templates/card-grid.tsx`: a filterable grid with a sliding chip highlight and cards that morph.
- `templates/detail-page.tsx`: the detail page the card grows into.

Copy them into the project, for example under `src/components/motion/`. Rename the CSS classes if they clash, and swap the colours for the project's own tokens.

## Steps

1. **Check the stack.**
   - In Next.js App Router, check the vendored React exports `ViewTransition` (`grep -o "exports.ViewTransition" node_modules/next/dist/compiled/react/cjs/react.development.js`). If it does, `import { ViewTransition, addTransitionType } from "react"` works with no config. Read `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` if present.
   - Plain React 19.2+: same imports.
   - Older React, or no React: use the fallback at the end of this file.
2. **Give both halves the same name.**
   - Wrap the card in `<Morph name={cardName(id)}>`.
   - Wrap the destination page's main panel (the whole content area, not just the title) in a `<Morph>` with the same name. Now the card grows into the page.
3. **Wrap every participating page** in `<PageMotion>`. Put it in each `page.tsx`, never in a layout. Everything else on the page steps back while the card grows and returns as it shrinks.
4. **Load the page before the click lands.** Use `IntentLink` for the card. It prefetches the full page as soon as the pointer, focus or a finger reaches the card. Without this, the page isn't ready, no pair forms, and the page only fades in. See the pitfalls below.
5. **Do the same for every other trigger.** The "Open" on a row grows into the row page, and "Add item" grows into the new-item form. Give each its own name helper.
6. **Filters move cards in place.** Change the filter inside `startTransition(() => { addTransitionType(FILTER); setGroup(g) })`. The cards are named, so they glide to their new places, and their enter and exit are mapped to `FILTER` only.
7. **Panels open from their anchor.** Reveal on-demand panels (bulk-delete bars, details, menus) with `RevealWhen`, or with a CSS grid-rows transition from the trigger's edge. Don't toggle `display`.
8. **Verify in a production build** (`next build && next start`). Next prefetches only in production, so `next dev` shows a fade instead of the morph. Click through with Playwright and collect `document.getAnimations().map(a => a.effect.pseudoElement)` right after the click. A working morph lists `::view-transition-group(<your-name>)` with both `-old` and `-new`. Screenshot a burst of frames 60 ms apart to see it mid-flight.

## Pitfalls (each one cost real time)

1. **A loading screen kills the morph.** If the destination shows a Suspense fallback (`loading.tsx`) first, no pair forms. Prefetch on intent (`IntentLink`) so the page renders in the same commit as the click.
2. **Server pages can't call client functions.** A server component calling a function exported from a `"use client"` file fails at runtime ("Attempted to call X() from the server"). Keep name helpers in a plain module (`motion-names.ts`). The client file may re-export them.
3. **Names must be CSS idents.** Table names, ids and row keys can hold any character, so hash them (`hashId` in `motion-names.ts`). Names must also be unique on the page at any moment.
4. **Snapshots stretch.** A card's snapshot gets stretched to the page's size and the text distorts. Clip it instead of scaling: `object-fit: none; object-position: left top` on old and new, plus `overflow: clip` and a border radius on the group (in `motion.css`).
5. **Ghosting.** When the old page fades as slowly as the morph, both overlap. Fade the old page out fast (about 140 ms) and start the new content late (about 140 ms delay).
6. **`default="none"` needs `share`.** Without `default="none"`, every named element crossfades on every transition. But if you set `default="none"` without `share="…"`, the pair silently stops morphing. Always set both.
7. **A sliding highlight can cover labels.** A view-transition highlight sliding between chips is painted above the page, so it hides the labels. Use a live, absolutely positioned indicator measured with `offsetLeft/offsetTop/offsetWidth`, with CSS transitions. During `FILTER` transitions, hide the old root snapshot (`:active-view-transition-type(...)` in `motion.css`) so the live page shows under the moving cards.
8. **Lost filters strand the card.** If the list's filter lives only in React state, coming back resets it and the card moves. Mirror the filter into the URL with `history.replaceState`, and read it back as the initial state.
9. **Breadcrumbs.** If the layout already has a back link or breadcrumb, don't add a second one. Matching names still morph back on any navigation, the browser back button included.
10. **Nested enter and exit don't fire.** Only the outermost new or removed `ViewTransition` animates. Keyed `Swap` regions inside a page animate only when their own key changes (search, sort, next page). That is the intended behaviour.
11. **Stale cache.** Going back morphs only if the list page is still cached (Next `staleTimes.dynamic`, or a hover prefetch on the back link). `BackTo` prefetches on intent for that reason.

## Copy and design (from the rule)

- Cards are calm: a monogram or icon tile, a title, a quiet subtitle, one key number, and at most one badge.
- Hover lifts the card 2 px with a soft shadow. Focus rings stay visible.
- The pill highlight is the only strong colour in the filter row.
- Times: morph 460 ms `cubic-bezier(0.2, 0.8, 0.2, 1)`, list moves 360 ms, crossfades 120–220 ms.

## Fallback without React's ViewTransition

```js
function go(card, href) {
  card.style.viewTransitionName = "active-card";
  if (!document.startViewTransition) return (location.href = href);
  document.startViewTransition(async () => {
    card.style.viewTransitionName = "";
    await render(href); // swap in the new page, whose main panel carries view-transition-name: active-card
  });
}
```

Use the same CSS from `motion.css`, targeting `::view-transition-group(active-card)`. For multi-page apps, add `@view-transition { navigation: auto; }` to both pages and set the same `view-transition-name` on the card and the destination panel.
