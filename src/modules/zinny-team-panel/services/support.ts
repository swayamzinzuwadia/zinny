/**
 * Support (platform.support_mode): entering a university's space through support mode,
 * who is in which university right now, force-ending a session, and the full activity
 * log with filters and CSV export.
 *
 * Entering and leaving go through core (`enterSupportMode`, `exitSupportMode`), which
 * log `support.enter` and `support.exit` in the university's audit log. Everything a
 * team member does inside carries the support session id.
 */
import { and, asc, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { auditLog, roleAssignments, supportSessions, universities, users } from "@/db/schema";
import { assertPlatform, enterSupportMode, exitSupportMode, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { formatDateTime, isDate } from "../lib/format";
import { db, isUuid, logAction, universityOrThrow } from "./shared";

/* ─────────────────────────── Sessions ─────────────────────────── */

export type SessionRow = {
  id: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  staffUserId: string;
  staffName: string;
  staffEmail: string;
  universityId: string;
  universityName: string;
  slug: string;
  /** Changes made inside the university during the session. */
  actions: number;
  /** Who force-ended it, when someone did. */
  forcedByName: string | null;
};

const sessionCols = {
  id: supportSessions.id,
  reason: supportSessions.reason,
  startedAt: supportSessions.startedAt,
  expiresAt: supportSessions.expiresAt,
  endedAt: supportSessions.endedAt,
  staffUserId: supportSessions.staffUserId,
  staffName: users.name,
  staffEmail: users.email,
  universityId: universities.id,
  universityName: universities.name,
  slug: universities.slug,
  actions: sql<number>`(select count(*) from ${auditLog} a where a.support_session_id = ${supportSessions.id} and a.action not like 'support.%')`.mapWith(Number),
  forcedByName: sql<string | null>`(select fu.name from ${auditLog} f join ${users} fu on fu.id = f.actor_user_id
    where f.action = 'support.force_end' and f.entity_id = ${supportSessions.id}::text order by f.at desc limit 1)`,
};

/** Open sessions right now, newest first: who is in which university. */
export async function activeSessions(actor: Actor, now = new Date()): Promise<SessionRow[]> {
  assertPlatform(actor, "platform.support_mode");
  return db()
    .select(sessionCols)
    .from(supportSessions)
    .innerJoin(users, eq(users.id, supportSessions.staffUserId))
    .innerJoin(universities, eq(universities.id, supportSessions.universityId))
    .where(and(isNull(supportSessions.endedAt), gt(supportSessions.expiresAt, now)))
    .orderBy(desc(supportSessions.startedAt));
}

/** The latest sessions, open or not. */
export async function recentSessions(actor: Actor, limit = 15): Promise<SessionRow[]> {
  assertPlatform(actor, "platform.support_mode");
  return db()
    .select(sessionCols)
    .from(supportSessions)
    .innerJoin(users, eq(users.id, supportSessions.staffUserId))
    .innerJoin(universities, eq(universities.id, supportSessions.universityId))
    .orderBy(desc(supportSessions.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export function sessionState(s: Pick<SessionRow, "endedAt" | "expiresAt">, now = new Date()): "open" | "ended" | "expired" {
  if (s.endedAt) return "ended";
  return s.expiresAt <= now ? "expired" : "open";
}

/** Universities to pick from, with the one this person supported last chosen first. */
export async function supportPicker(actor: Actor) {
  assertPlatform(actor, "platform.support_mode");
  const conn = db();
  const unis = await conn
    .select({ id: universities.id, name: universities.name, slug: universities.slug, status: universities.status })
    .from(universities)
    .orderBy(asc(universities.name));
  const [last] = await conn
    .select({ universityId: supportSessions.universityId })
    .from(supportSessions)
    .where(eq(supportSessions.staffUserId, actor.userId))
    .orderBy(desc(supportSessions.startedAt))
    .limit(1);
  return { universities: unis, lastUniversityId: last?.universityId ?? unis[0]?.id ?? null };
}

/** Enters a university's space (core `enterSupportMode`, which logs support.enter). Returns where to go. */
export async function startSupport(actor: Actor, universityId: string, reason: string) {
  assertPlatform(actor, "platform.support_mode");
  if (!universityId || !isUuid(universityId)) throw new ValidationError("Pick the university you are helping.");
  const why = reason.trim();
  if (why.length < 5) throw new ValidationError("Write a short reason for entering support mode, like the ticket number.");
  if (why.length > 300) throw new ValidationError("Keep the reason under 300 characters.");
  const uni = await universityOrThrow(db(), universityId);
  const session = await enterSupportMode(actor, uni.id, why);
  return { sessionId: session.id, slug: uni.slug, universityName: uni.name };
}

/** Leaves your own session (core `exitSupportMode`, which logs support.exit). */
export async function leaveSupport(actor: Actor, sessionId: string) {
  if (!isUuid(sessionId)) throw new NotFoundError("Support session");
  const [s] = await db().select().from(supportSessions).where(eq(supportSessions.id, sessionId));
  if (!s || s.staffUserId !== actor.userId) throw new NotFoundError("Support session");
  if (s.endedAt) throw new ConflictError("You have already left this session.");
  await exitSupportMode(actor, sessionId);
}

/**
 * Ends someone else's open session now. The session's owner is out of the university
 * on their next click. Logged as `support.force_end` in the university's audit log,
 * with who ended it and why, next to core's own `support.exit`.
 */
export async function forceEndSupport(actor: Actor, sessionId: string, reason: string) {
  assertPlatform(actor, "platform.support_mode");
  if (!isUuid(sessionId)) throw new NotFoundError("Support session");
  const [s] = await db()
    .select({ session: supportSessions, name: users.name, email: users.email })
    .from(supportSessions)
    .innerJoin(users, eq(users.id, supportSessions.staffUserId))
    .where(eq(supportSessions.id, sessionId));
  if (!s) throw new NotFoundError("Support session");
  if (s.session.endedAt || s.session.expiresAt <= new Date()) throw new ConflictError("This session has already ended.");
  if (s.session.staffUserId === actor.userId) {
    await exitSupportMode(actor, sessionId);
    return { forced: false };
  }
  const why = reason.trim();
  if (why.length < 5) throw new ValidationError("Write why you are ending this session.");
  if (why.length > 300) throw new ValidationError("Keep the reason under 300 characters.");

  // Core's exitSupportMode ends only the caller's own session (it matches the session's
  // owner). Until core offers a force-end (requested in the handoff), the panel ends it on
  // the owner's behalf with a bare actor that holds no roles and can do nothing else,
  // and logs below who actually ended it.
  const owner: Actor = { userId: s.session.staffUserId, name: s.name, email: s.email, universityId: null, assignments: [], supportSessionId: null };
  await exitSupportMode(owner, sessionId);
  await db().transaction((tx) =>
    logAction(tx, actor, { universityId: s.session.universityId, inUniversityLog: true }, "support.force_end", "support_session", sessionId, {
      staffUserId: s.session.staffUserId,
      staffName: s.name,
      reason: why,
    }),
  );
  return { forced: true };
}

/* ─────────────────────────── Activity log ─────────────────────────── */

export const ACTION_LABELS: Record<string, string> = {
  "support.enter": "Entered support mode",
  "support.exit": "Left support mode",
  "support.force_end": "Force-ended a support session",
  "university.create": "Created the university",
  "university.update": "Changed the university's details",
  "platform.role_grant": "Gave a Zinny team role",
  "platform.role_revoke": "Removed a Zinny team role",
  "plat.licence.create": "Set up the licence",
  "plat.licence.update": "Changed the licence",
  "plat.alert.raise": "Licence warning raised",
  "plat.alert.resolve": "Licence warning cleared",
  "plat.alert.acknowledge": "Marked a licence warning as handled",
  "plat.university.suspend": "Suspended the university",
  "plat.university.reactivate": "Reactivated the university",
  "plat.review.clear": "Reviewed a course, no issues",
  "plat.flag.create": "Flagged a course",
  "plat.flag.resolve": "Resolved a content flag",
  "plat.partner.create": "Added a partner",
  "plat.partner.update": "Changed a partner",
  "plat.partner.contact_add": "Added a partner contact",
  "plat.partner.contact_remove": "Removed a partner contact",
  "plat.partner.note": "Added a partner note",
  "plat.invoice.create": "Issued a Zinny invoice",
  "plat.invoice.paid": "Marked a Zinny invoice paid",
  "plat.invoice.unpaid": "Marked a Zinny invoice unpaid",
  "plat.log.export": "Exported the activity log",
};

/** "course.add_lesson" → "Course add lesson" for actions without a label. */
export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? (action.charAt(0).toUpperCase() + action.slice(1)).replace(/[._]/g, " ");
}

export type LogScope = "support" | "all";
export type LogFilters = { scope: LogScope; universityId?: string; personId?: string; action?: string; from?: string; to?: string };

/** Turns query-string values into filters, dropping anything malformed. Returns what was dropped. */
export function parseLogFilters(q: Record<string, string | string[] | undefined>): { filters: LogFilters; problems: string[] } {
  const one = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const problems: string[] = [];
  const filters: LogFilters = { scope: one("scope") === "all" ? "all" : "support" };
  const uni = one("university");
  if (uni) {
    if (isUuid(uni)) filters.universityId = uni;
    else problems.push("university");
  }
  const person = one("person");
  if (person) {
    if (isUuid(person)) filters.personId = person;
    else problems.push("person");
  }
  const action = one("action");
  if (action) {
    if (/^[a-z0-9_.]{2,80}$/.test(action)) filters.action = action;
    else problems.push("action");
  }
  for (const k of ["from", "to"] as const) {
    const v = one(k);
    if (!v) continue;
    if (isDate(v)) filters[k] = v;
    else problems.push(k === "from" ? "from date" : "to date");
  }
  if (filters.from && filters.to && filters.to < filters.from) {
    problems.push("date range");
    delete filters.to;
  }
  return { filters, problems };
}

/** Start of a day in India time, as a moment. */
const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

function whereFor(f: LogFilters): SQL {
  const conds: (SQL | undefined)[] = [
    f.scope === "support"
      ? sql`(${auditLog.supportSessionId} is not null or ${auditLog.action} like 'support.%')`
      : sql`(${auditLog.supportSessionId} is not null or ${auditLog.action} like 'support.%' or ${auditLog.action} like 'plat.%'
             or ${auditLog.action} like 'platform.%' or ${auditLog.action} like 'university.%')`,
    f.universityId ? sql`(${auditLog.universityId} = ${f.universityId} or ${auditLog.data}->>'universityId' = ${f.universityId})` : undefined,
    f.personId ? eq(auditLog.actorUserId, f.personId) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined,
    f.from ? sql`${auditLog.at} >= ${istStart(f.from)}` : undefined,
    f.to ? sql`${auditLog.at} < ${new Date(istStart(f.to).getTime() + 86_400_000)}` : undefined,
  ];
  return and(...conds)!;
}

export type LogEntry = {
  id: string;
  at: Date;
  action: string;
  entity: string;
  entityId: string | null;
  data: Record<string, unknown>;
  actorName: string | null;
  actorEmail: string | null;
  universityName: string | null;
  supportSessionId: string | null;
  sessionReason: string | null;
};

function selectLog() {
  return db()
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      data: auditLog.data,
      actorName: users.name,
      actorEmail: users.email,
      universityName: universities.name,
      supportSessionId: auditLog.supportSessionId,
      sessionReason: supportSessions.reason,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .leftJoin(universities, sql`${universities.id}::text = coalesce(${auditLog.universityId}::text, ${auditLog.data}->>'universityId')`)
    .leftJoin(supportSessions, eq(supportSessions.id, auditLog.supportSessionId));
}

export const LOG_PAGE_SIZE = 50;

/** One page of the activity log, newest first. */
export async function activityLog(actor: Actor, filters: LogFilters, page = 1): Promise<{ entries: LogEntry[]; hasMore: boolean; page: number }> {
  assertPlatform(actor, "platform.support_mode");
  const p = Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
  const rows = await selectLog()
    .where(whereFor(filters))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(LOG_PAGE_SIZE + 1)
    .offset((p - 1) * LOG_PAGE_SIZE);
  return { entries: rows.slice(0, LOG_PAGE_SIZE) as LogEntry[], hasMore: rows.length > LOG_PAGE_SIZE, page: p };
}

/** People and actions to filter the log by. */
export async function activityLogOptions(actor: Actor, scope: LogScope) {
  assertPlatform(actor, "platform.support_mode");
  const conn = db();
  const [people, actions, unis] = await Promise.all([
    conn
      .selectDistinct({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
      .where(eq(roleAssignments.scopeType, "platform"))
      .orderBy(asc(users.name)),
    conn
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .where(whereFor({ scope }))
      .orderBy(asc(auditLog.action))
      .limit(300),
    conn.select({ id: universities.id, name: universities.name }).from(universities).orderBy(asc(universities.name)),
  ]);
  return { people, actions: actions.map((a) => a.action), universities: unis };
}

export const EXPORT_LIMIT = 50_000;

/** A spreadsheet cell: quoted, and never read as a formula. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The filtered log as CSV (up to 50,000 rows). The export itself is logged. */
export async function activityLogCsv(actor: Actor, filters: LogFilters): Promise<{ csv: string; rows: number; truncated: boolean }> {
  assertPlatform(actor, "platform.support_mode");
  const rows = (await selectLog()
    .where(whereFor(filters))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(EXPORT_LIMIT + 1)) as LogEntry[];
  const truncated = rows.length > EXPORT_LIMIT;
  const list = rows.slice(0, EXPORT_LIMIT);
  const head = ["When (IST)", "Person", "Email", "University", "Action", "What happened", "Record", "Record id", "Support session", "Session reason", "Details"];
  const lines = [head.map(cell).join(",")];
  for (const r of list) {
    lines.push(
      [
        formatDateTime(r.at),
        r.actorName ?? "Zinny system",
        r.actorEmail ?? "",
        r.universityName ?? "",
        r.action,
        actionLabel(r.action),
        r.entity,
        r.entityId ?? "",
        r.supportSessionId ?? "",
        r.sessionReason ?? "",
        r.data && Object.keys(r.data).length ? r.data : "",
      ]
        .map(cell)
        .join(","),
    );
  }
  await db().transaction((tx) =>
    logAction(tx, actor, { universityId: null }, "plat.log.export", "audit_log", null, { filters, rows: list.length, truncated }),
  );
  // A byte-order mark so spreadsheet apps read ₹ and names in other scripts correctly.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, rows: list.length, truncated };
}
