/**
 * card-to-page-ui: view-transition names and transition types.
 * A plain module (no "use client"), so server components can call these too.
 */

/** A short, CSS-safe id for any text: ids and keys can hold any character. */
export function hashId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** One helper per kind of trigger. The card and the page it opens must use the same one. */
export const cardName = (id: string) => `ctp-card-${hashId(id)}`;
export const addName = (scope: string) => `ctp-add-${hashId(scope)}`;
export const rowName = (scope: string, key: string) => `ctp-row-${hashId(`${scope}\u0000${key}`)}`;

/** Types a navigation or state change carries, so pages know what kind of change it is. */
export const OPEN = "ctp-open";
export const CLOSE = "ctp-close";
/** A filter on a list changed: cards move, the page stays. */
export const FILTER = "ctp-filter";
