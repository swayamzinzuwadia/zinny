/**
 * Finding things by what someone types: every word must appear in the item's text, case and
 * accents ignored. Items whose name starts with the query come first, then the rest by name.
 */
const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function findMatches<T>(query: string, items: T[], text: (item: T) => string[], name: (item: T) => string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const q = words.join(" ");
  return items
    .map((item) => ({ item, hay: fold(text(item).join(" ")), title: fold(name(item)) }))
    .filter((x) => words.every((w) => x.hay.includes(w)))
    .sort((a, b) => Number(b.title.startsWith(q)) - Number(a.title.startsWith(q)) || a.title.localeCompare(b.title))
    .map((x) => x.item);
}
