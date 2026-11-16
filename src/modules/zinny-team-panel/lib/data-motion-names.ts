/** View-transition names and types for the data console. Plain functions, so server pages can use them. */

/** A short, CSS-safe id for any text (table names and row keys can hold any character). */
function hashId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const tableMorphName = (table: string) => `data-table-${hashId(table)}`;
export const addRowMorphName = (table: string) => `data-add-${hashId(table)}`;
export const rowMorphName = (table: string, key: string) =>
  `data-row-${hashId(`${table}\u0000${key}`)}`;

/** Types a navigation carries, so the page knows whether it opened or closed something. */
export const OPEN = "data-open";
export const CLOSE = "data-close";
/** A filter on the table list changed; cards move, the page stays. */
export const FILTER = "data-filter";

