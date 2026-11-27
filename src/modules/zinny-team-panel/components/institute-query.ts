/**
 * Filtering, sorting and paging for the institutes table, read from the address so a view
 * can be shared. Pure functions over the rows the service returns.
 */
import type { UniversityListRow } from "../services/universities";

export const STATUS_FILTERS = ["active", "trial", "frozen", "suspended"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const SORTS = ["name", "created", "students", "licence", "status"] as const;
export type SortKey = (typeof SORTS)[number];
export const PAGE_SIZE = 25;

export type InstituteQuery = {
  q: string;
  status: StatusFilter | "";
  plan: string;
  ending: boolean;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseInstituteQuery(sp: Raw): InstituteQuery {
  const status = one(sp.status);
  const sort = one(sp.sort);
  const sortKey = (SORTS as readonly string[]).includes(sort) ? (sort as SortKey) : "name";
  const dirRaw = one(sp.dir);
  return {
    q: one(sp.q).trim().slice(0, 80),
    status: (STATUS_FILTERS as readonly string[]).includes(status) ? (status as StatusFilter) : "",
    plan: one(sp.plan).slice(0, 40),
    ending: one(sp.ending) === "1",
    sort: sortKey,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sortKey === "name" || sortKey === "status" || sortKey === "licence" ? "asc" : "desc",
    page: Math.max(1, Math.floor(Number(one(sp.page))) || 1),
  };
}

/**
 * What an institute is, for filtering: suspended and frozen come from its status; a trial is
 * an institute whose status says so, whose licence is the Pilot plan, or that signed itself up
 * and has no licence yet (its free trial); the rest are active.
 */
export function effectiveStatus(u: Pick<UniversityListRow, "status" | "plan"> & { trialEndsAt?: string | null }): StatusFilter {
  if (u.status === "suspended") return "suspended";
  if (u.status === "frozen") return "frozen";
  if (u.status === "trial" || u.plan === "pilot" || (!u.plan && u.trialEndsAt)) return "trial";
  return "active";
}

const ENDING_DAYS = 30;
const endingSoon = (u: UniversityListRow) => u.daysLeft !== null && u.daysLeft <= ENDING_DAYS;

export function matchesQuery(u: UniversityListRow, f: InstituteQuery): boolean {
  const term = f.q.toLowerCase();
  if (term && !u.name.toLowerCase().includes(term) && !u.slug.includes(term)) return false;
  if (f.status && effectiveStatus(u) !== f.status) return false;
  if (f.plan && (f.plan === "none" ? u.plan : u.plan !== f.plan)) return false;
  if (f.ending && !endingSoon(u)) return false;
  return true;
}

const STATUS_ORDER: Record<StatusFilter, number> = { active: 0, trial: 1, frozen: 2, suspended: 3 };

export function sortInstitutes(rows: UniversityListRow[], sort: SortKey, dir: "asc" | "desc"): UniversityListRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const by = (a: UniversityListRow, b: UniversityListRow): number => {
    switch (sort) {
      case "created":
        return a.createdAt.getTime() - b.createdAt.getTime();
      case "students":
        return a.students - b.students;
      case "licence":
        return (a.endDate ?? "").localeCompare(b.endDate ?? "");
      case "status":
        return STATUS_ORDER[effectiveStatus(a)] - STATUS_ORDER[effectiveStatus(b)];
      default:
        return a.name.localeCompare(b.name);
    }
  };
  return [...rows].sort((a, b) => {
    // Institutes without a licence date always sit last, whichever way it is sorted.
    if (sort === "licence" && !a.endDate !== !b.endDate) return a.endDate ? -1 : 1;
    return sign * by(a, b) || a.name.localeCompare(b.name);
  });
}

export type InstitutePage = {
  rows: UniversityListRow[];
  total: number;
  matching: number;
  page: number;
  pages: number;
  counts: Record<StatusFilter, number> & { ending: number };
  plans: { key: string; name: string; count: number }[];
};

export function queryInstitutes(all: UniversityListRow[], f: InstituteQuery): InstitutePage {
  // Counts on the status chips follow the search and the other filters, so they match what a click shows.
  const counts = { active: 0, trial: 0, frozen: 0, suspended: 0, ending: all.filter(endingSoon).length };
  for (const u of all.filter((x) => matchesQuery(x, { ...f, status: "" }))) counts[effectiveStatus(u)]++;
  const matching = sortInstitutes(
    all.filter((u) => matchesQuery(u, f)),
    f.sort,
    f.dir,
  );
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const planMap = new Map<string, { key: string; name: string; count: number }>();
  for (const u of all) {
    if (!u.plan) continue;
    const p = planMap.get(u.plan) ?? { key: u.plan, name: u.planName ?? u.plan, count: 0 };
    p.count++;
    planMap.set(u.plan, p);
  }
  return {
    rows: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: all.length,
    matching: matching.length,
    page,
    pages,
    counts,
    plans: [...planMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The address for a view, leaving out anything at its default. */
export function instituteHref(f: Partial<InstituteQuery>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.plan) p.set("plan", f.plan);
  if (f.ending) p.set("ending", "1");
  if (f.sort && f.sort !== "name") p.set("sort", f.sort);
  if (f.sort && f.sort !== "name" && f.dir) p.set("dir", f.dir);
  if (f.sort === "name" && f.dir === "desc") p.set("dir", "desc");
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return `/platform/institutes${s ? `?${s}` : ""}`;
}
