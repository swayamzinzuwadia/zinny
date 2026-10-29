/**
 * Analytics (platform.view_analytics): universities, active students, enrolments per
 * week and money collected by universities per month, overall and per university.
 * Weeks start on Monday and months follow India time, so every university is counted
 * on the same calendar.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { enrolments, orders, universities } from "@/db/schema";
import { assertPlatform, type Actor } from "@/server/core";
import { addDays, addMonths, monthOf, todayIST, weekStart, ZINNY_TZ } from "../lib/format";
import { db, emptyUsage, isUuid, usageFor } from "./shared";

/** Orders whose money reached the university (before any refund). */
const COLLECTED = ["paid", "refund_due", "refunded"] as const;

const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

export type Analytics = {
  universityId: string | null;
  universities: { total: number; active: number; suspended: number };
  students: number;
  activeStudents: number;
  weeks: { week: string; enrolments: number }[];
  months: { month: string; paise: number; payments: number }[];
  perUniversity: {
    id: string;
    name: string;
    status: string;
    students: number;
    activeStudents: number;
    enrolments12w: number;
    collectedMonth: number;
    collected12m: number;
  }[];
};

/**
 * The numbers for the analytics page. With `universityId`, everything is narrowed to that
 * university; the per-university table always lists every university.
 */
export async function analytics(actor: Actor, opts: { universityId?: string; weeks?: number; months?: number } = {}, today = todayIST()): Promise<Analytics> {
  assertPlatform(actor, "platform.view_analytics");
  const conn = db();
  const uni = opts.universityId && isUuid(opts.universityId) ? opts.universityId : null;
  const nWeeks = Math.min(Math.max(opts.weeks ?? 12, 4), 52);
  const nMonths = Math.min(Math.max(opts.months ?? 12, 3), 24);
  const firstWeek = addDays(weekStart(today), -7 * (nWeeks - 1));
  const firstMonth = `${monthOf(addMonths(`${monthOf(today)}-01`, -(nMonths - 1)))}-01`;
  const thisMonth = `${monthOf(today)}-01`;

  const [unis, usage, active, weekly, monthly] = await Promise.all([
    conn.select({ id: universities.id, name: universities.name, status: universities.status }).from(universities).orderBy(asc(universities.name)),
    usageFor(conn),
    conn
      .select({ universityId: enrolments.universityId, n: sql<number>`count(distinct ${enrolments.userId})`.mapWith(Number) })
      .from(enrolments)
      .where(eq(enrolments.status, "active"))
      .groupBy(enrolments.universityId),
    conn
      .select({
        universityId: enrolments.universityId,
        week: sql<string>`to_char(date_trunc('week', ${enrolments.enrolledAt} at time zone ${ZINNY_TZ}), 'YYYY-MM-DD')`,
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(enrolments)
      .where(and(isNotNull(enrolments.enrolledAt), sql`${enrolments.enrolledAt} >= ${istStart(firstWeek)}`))
      .groupBy(enrolments.universityId, sql`2`),
    conn
      .select({
        universityId: orders.universityId,
        month: sql<string>`to_char(date_trunc('month', ${orders.paidAt} at time zone ${ZINNY_TZ}), 'YYYY-MM')`,
        paise: sql<number>`coalesce(sum(${orders.totalPaise}), 0)`.mapWith(Number),
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(orders)
      .where(and(isNotNull(orders.paidAt), inArray(orders.status, [...COLLECTED]), sql`${orders.paidAt} >= ${istStart(firstMonth)}`))
      .groupBy(orders.universityId, sql`2`),
  ]);

  const activeOf = new Map(active.map((a) => [a.universityId, a.n]));
  const inScope = (id: string) => !uni || id === uni;
  const scoped = unis.filter((u) => inScope(u.id));

  const weeks = Array.from({ length: nWeeks }, (_, i) => addDays(firstWeek, 7 * i)).map((week) => ({
    week,
    enrolments: weekly.filter((w) => w.week === week && inScope(w.universityId)).reduce((s, w) => s + w.n, 0),
  }));
  const months = Array.from({ length: nMonths }, (_, i) => monthOf(addMonths(firstMonth, i))).map((month) => {
    const rows = monthly.filter((m) => m.month === month && inScope(m.universityId));
    return { month, paise: rows.reduce((s, m) => s + m.paise, 0), payments: rows.reduce((s, m) => s + m.n, 0) };
  });

  const perUniversity = unis.map((u) => ({
    id: u.id,
    name: u.name,
    status: u.status,
    students: (usage.get(u.id) ?? emptyUsage()).students,
    activeStudents: activeOf.get(u.id) ?? 0,
    enrolments12w: weekly.filter((w) => w.universityId === u.id).reduce((s, w) => s + w.n, 0),
    collectedMonth: monthly.filter((m) => m.universityId === u.id && m.month === monthOf(thisMonth)).reduce((s, m) => s + m.paise, 0),
    collected12m: monthly.filter((m) => m.universityId === u.id).reduce((s, m) => s + m.paise, 0),
  }));

  return {
    universityId: uni,
    universities: {
      total: scoped.length,
      active: scoped.filter((u) => u.status === "active").length,
      suspended: scoped.filter((u) => u.status === "suspended").length,
    },
    students: scoped.reduce((s, u) => s + (usage.get(u.id) ?? emptyUsage()).students, 0),
    activeStudents: scoped.reduce((s, u) => s + (activeOf.get(u.id) ?? 0), 0),
    weeks,
    months,
    perUniversity,
  };
}
