/**
 * Links into the data console (/platform/data). Kept apart from the service so any page can
 * build a link without touching the database.
 *
 * A row is found by its primary key values, in the key's column order, as text. They travel
 * in the URL as base64url JSON, so composite keys and any characters survive.
 */

export function encodeRowKey(values: string[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/** The key's values, or null when the text isn't a key this console made. */
export function decodeRowKey(raw: string | null | undefined): string[] | null {
  if (!raw || raw.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export const dataTableHref = (table: string, params: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return `/platform/data/${encodeURIComponent(table)}${s ? `?${s}` : ""}`;
};

export const dataRowHref = (table: string, key: string[]) => `/platform/data/${encodeURIComponent(table)}/row?key=${encodeRowKey(key)}`;
