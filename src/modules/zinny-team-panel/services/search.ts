/**
 * Global search for the top bar of the Zinny team panel. One call returns grouped,
 * ranked results, and each group is only looked up when this person may open that kind of
 * thing (the same checks as the pages). Read-only; every group is capped.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { courses, roleAssignments, universities, users } from "@/db/schema";
import { ROLE_LABELS } from "@/server/authz/roles";
import { canPlatform, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { canSeeContentFlags, isSuperAdmin, isZinnyTeam } from "../lib/access";
import { pageScore, pagesFor, searchPages, suggestedPages } from "../lib/search-index";
import { platInvoices, platPlans } from "../schema";
import { db } from "./shared";
import { searchUniversities } from "./universities";

export const SEARCH_GROUPS = [
  { kind: "page", label: "Pages and features" },
  { kind: "institute", label: "Institutes" },
  { kind: "person", label: "People" },
  { kind: "plan", label: "Plans" },
  { kind: "invoice", label: "Invoices" },
  { kind: "course", label: "Courses in content review" },
] as const;

export type SearchKind = (typeof SEARCH_GROUPS)[number]["kind"];
/** One result row. `title` is the part that is matched and highlighted; `detail` is a quieter second line. */
export type SearchHit = { kind: SearchKind; id: string; title: string; detail: string; href: string; tag?: string; tone?: "danger" };
export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

export const GROUP_CAP = 5;
const MAX_TERM = 80;

const likeOf = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const STATUS: Record<string, string> = { active: "Active", suspended: "Suspended", trial: "Trial", frozen: "Frozen" };

/** Best first: starts with the term, then a word starts with it, then contains it. */
function rankBy<T>(rows: T[], term: string, text: (r: T) => string, limit = GROUP_CAP): T[] {
  const needle = term.toLowerCase();
  const score = (r: T) => {
    const t = text(r).toLowerCase();
    return t.startsWith(needle) ? 0 : t.split(/[\s\-_.,@/()]+/).some((w) => w.startsWith(needle)) ? 1 : 2;
  };
  return rows
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => a.s - b.s || text(a.r).length - text(b.r).length || text(a.r).localeCompare(text(b.r)))
    .slice(0, limit)
    .map((x) => x.r);
}

export async function globalSearch(actor: Actor, query: string): Promise<SearchGroup[]> {
  if (!isZinnyTeam(actor)) throw new ForbiddenError("Only the Zinny team can search the panel.");
  const term = query.trim().slice(0, MAX_TERM);
  if (!term) {
    // Nothing typed yet: a few pages worth opening.
    const picks = suggestedPages(pagesFor(actor)).map<SearchHit>((p) => ({ kind: "page", id: p.href, title: p.label, detail: p.hint || p.section, href: p.href, tag: p.section }));
    return picks.length ? [{ kind: "page", label: "Suggested pages", hits: picks }] : [];
  }
  const like = likeOf(term);
  const conn = db();

  const pages = searchPages(pagesFor(actor), term, 6).map<SearchHit>((p) => ({ kind: "page", id: p.href, title: p.label, detail: p.hint || p.section, href: p.href, tag: p.section }));

  const institutes = canPlatform(actor, "platform.manage_universities")
    ? searchUniversities(actor, term, GROUP_CAP).then((rows) =>
        rows.map<SearchHit>((u) => ({
          kind: "institute",
          id: u.id,
          title: u.name,
          detail: `zinny.app/${u.slug}`,
          href: `/platform/institutes/${u.id}`,
          tag: [u.planName ?? "No licence", STATUS[u.status] ?? u.status].join(" · "),
          tone: u.status === "suspended" ? "danger" : undefined,
        })),
      )
    : Promise.resolve([]);

  const people =
    isSuperAdmin(actor) && term.length >= 2
      ? (async () => {
          const found = await conn
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(or(ilike(users.name, like), ilike(users.email, like)))
            .orderBy(asc(sql`lower(${users.name})`))
            .limit(60);
          const best = rankBy(found, term, (u) => u.name);
          if (!best.length) return [];
          const ids = best.map((b) => b.id);
          const roles = await conn
            .select({ userId: roleAssignments.userId, role: roleAssignments.role, university: universities.name })
            .from(roleAssignments)
            .leftJoin(universities, eq(universities.id, roleAssignments.universityId))
            .where(and(inArray(roleAssignments.userId, ids), isNull(roleAssignments.revokedAt)));
          return best.map<SearchHit>((u) => {
            const mine = roles.filter((r) => r.userId === u.id);
            const first = mine.find((r) => r.role !== "student") ?? mine[0];
            return {
              kind: "person",
              id: u.id,
              title: u.name,
              detail: u.email,
              href: `/platform/people/${u.id}`,
              tag: first ? [ROLE_LABELS[first.role] ?? first.role, first.university].filter(Boolean).join(" · ") : "No role",
            };
          });
        })()
      : Promise.resolve([]);

  const plans = canPlatform(actor, "platform.licences")
    ? conn
        .select({ id: platPlans.id, key: platPlans.key, name: platPlans.name, archivedAt: platPlans.archivedAt })
        .from(platPlans)
        .where(or(ilike(platPlans.name, like), ilike(platPlans.key, like)))
        .limit(40)
        .then((rows) =>
          rankBy(rows, term, (p) => p.name).map<SearchHit>((p) => ({ kind: "plan", id: p.id, title: p.name, detail: p.key, href: `/platform/plans/${p.id}`, tag: p.archivedAt ? "Archived" : undefined })),
        )
    : Promise.resolve([]);

  const invoices = canPlatform(actor, "platform.finance")
    ? conn
        .select({ id: platInvoices.id, number: platInvoices.number, status: platInvoices.status, dueDate: platInvoices.dueDate, institute: universities.name })
        .from(platInvoices)
        .innerJoin(universities, eq(universities.id, platInvoices.universityId))
        .where(or(ilike(platInvoices.number, like), ilike(universities.name, like)))
        .orderBy(desc(platInvoices.issueDate), desc(platInvoices.number))
        .limit(60)
        .then((rows) =>
          rankBy(rows, term, (r) => r.number).map<SearchHit>((r) => ({
            kind: "invoice",
            id: r.id,
            title: r.number,
            detail: r.institute,
            href: `/platform/billing/${r.id}`,
            tag: r.status === "paid" ? "Paid" : "Unpaid",
          })),
        )
    : Promise.resolve([]);

  const coursesFound =
    canSeeContentFlags(actor) && term.length >= 2
      ? conn
          .select({ id: courses.id, title: courses.title, institute: universities.name })
          .from(courses)
          .innerJoin(universities, eq(universities.id, courses.universityId))
          .where(ilike(courses.title, like))
          .orderBy(desc(courses.createdAt))
          .limit(60)
          .then((rows) => rankBy(rows, term, (c) => c.title).map<SearchHit>((c) => ({ kind: "course", id: c.id, title: c.title, detail: c.institute, href: `/platform/content/${c.id}` })))
      : Promise.resolve([]);

  const [inst, ppl, pl, inv, crs] = await Promise.all([institutes, people, plans, invoices, coursesFound]);
  const byKind: Record<SearchKind, SearchHit[]> = { page: pages, institute: inst, person: ppl, plan: pl, invoice: inv, course: crs };
  const groups = SEARCH_GROUPS.map((g) => ({ kind: g.kind, label: g.label, hits: byKind[g.kind].slice(0, GROUP_CAP + (g.kind === "page" ? 1 : 0)) })).filter((g) => g.hits.length > 0);
  // Pages lead when the word is really about a page; a weak page match ("contains") drops below the records.
  const best = Math.min(...searchPages(pagesFor(actor), term, 1).map((p) => pageScore(p, term) ?? 9), 9);
  return best > 2 ? [...groups.filter((g) => g.kind !== "page"), ...groups.filter((g) => g.kind === "page")] : groups;
}
