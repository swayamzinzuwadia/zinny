/**
 * Shared pieces for the Zinny team panel's services.
 *
 * The Zinny team works outside any one university, so these services use the system
 * connection (the exception named in the brief), always after `assertPlatform`. They
 * read core tables directly and change university data only through the core API.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { systemDb, type Conn, type Tx } from "@/db/client";
import { roleAssignments, universities } from "@/db/schema";
import { audit, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { STAFF_ROLES } from "../lib/constants";

export const db = () => systemDb();

/**
 * Logs a Zinny team action through core `audit`. With a university id the entry lands in
 * that university's audit log (licence changes, its invoices, suspensions); without one
 * it is a platform entry. `data.universityId` is always set when a university is involved,
 * so the activity log can filter on it either way.
 */
export async function logAction(
  tx: Tx,
  actor: Actor,
  opts: { universityId?: string | null; inUniversityLog?: boolean },
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
) {
  const uni = opts.universityId ?? null;
  const as: Actor = { ...actor, universityId: opts.inUniversityLog && uni ? uni : null, supportSessionId: null };
  await audit(tx, as, action, entity, entityId, uni ? { universityId: uni, ...data } : data);
}

export type Usage = { students: number; staff: number };

/**
 * People who count towards a licence, per university: students hold an active `student`
 * role; staff hold an active administration or teaching role. A person counts once per
 * university however many roles they hold. Revoked and expired roles don't count.
 * Works on the system connection (all universities) and inside withTenant (one).
 */
export async function usageFor(conn: Conn, universityIds?: string[], now = new Date()): Promise<Map<string, Usage>> {
  if (universityIds && universityIds.length === 0) return new Map();
  const rows = await conn
    .select({
      universityId: roleAssignments.universityId,
      students: sql<number>`count(distinct ${roleAssignments.userId}) filter (where ${roleAssignments.role} = 'student')`.mapWith(Number),
      staff: sql<number>`count(distinct ${roleAssignments.userId}) filter (where ${inArray(roleAssignments.role, [...STAFF_ROLES])})`.mapWith(Number),
    })
    .from(roleAssignments)
    .where(
      and(
        isNotNull(roleAssignments.universityId),
        isNull(roleAssignments.revokedAt),
        lte(roleAssignments.startsAt, now),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
        universityIds ? inArray(roleAssignments.universityId, universityIds) : undefined,
      ),
    )
    .groupBy(roleAssignments.universityId);
  return new Map(rows.map((r) => [r.universityId!, { students: r.students, staff: r.staff }]));
}

export const emptyUsage = (): Usage => ({ students: 0, staff: 0 });

export async function universityOrThrow(conn: Conn, universityId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(universityId)) throw new NotFoundError("University");
  const [u] = await conn.select().from(universities).where(eq(universities.id, universityId));
  if (!u) throw new NotFoundError("University");
  return u;
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Postgres unique violation, through drizzle's wrapper. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
