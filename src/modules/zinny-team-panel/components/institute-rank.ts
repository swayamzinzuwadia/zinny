/**
 * Ranking for the institute search: names that start with what was typed come first,
 * then names with a word that starts with it, then web addresses, then anything that just
 * contains it. Pure, so the dropdown, the server route and the tests agree.
 */

export type Searchable = { name: string; slug: string };
export type Span = [start: number, end: number];

const norm = (s: string) => s.toLowerCase();

/** Where `q` sits inside `text`, ignoring case: one span, or none. */
export function matchSpan(text: string, q: string): Span | null {
  const needle = norm(q.trim());
  if (!needle) return null;
  const i = norm(text).indexOf(needle);
  return i < 0 ? null : [i, i + needle.length];
}

/** 0 name starts with q, 1 a word of the name does, 2 web address starts with q, 3 name contains q, 4 web address contains q; null for no match. */
export function scoreOf(row: Searchable, q: string): number | null {
  const needle = norm(q.trim());
  if (!needle) return null;
  const name = norm(row.name);
  const slug = norm(row.slug);
  if (name.startsWith(needle)) return 0;
  if (name.split(/[\s\-_.,&/()]+/).some((w) => w.startsWith(needle))) return 1;
  if (slug.startsWith(needle)) return 2;
  if (name.includes(needle)) return 3;
  if (slug.includes(needle)) return 4;
  return null;
}

export type Ranked<T> = T & { score: number };

/** The best `limit` matches, best first; equal scores go shortest name first, then A to Z. */
export function rankInstitutes<T extends Searchable>(rows: T[], q: string, limit = 8): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const r of rows) {
    const score = scoreOf(r, q);
    if (score !== null) out.push({ ...r, score });
  }
  return out.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Splits text into pieces, marking the part that matched. */
export function highlightParts(text: string, q: string): { text: string; hit: boolean }[] {
  const span = matchSpan(text, q);
  if (!span) return [{ text, hit: false }];
  return [
    { text: text.slice(0, span[0]), hit: false },
    { text: text.slice(span[0], span[1]), hit: true },
    { text: text.slice(span[1]), hit: false },
  ].filter((p) => p.text);
}
