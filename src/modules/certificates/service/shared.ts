/** Helpers shared by the certificates services: tenant, scope filters, error mapping. */
import { inArray, or, sql, type SQL } from "drizzle-orm";
import { can, reach, type Action, type Actor, type Target } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { certCertificates } from "../schema";

export function uni(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("No university selected.");
  return actor.universityId;
}

/** The permission target of an issued certificate: its university, department and batch. */
export function certificateTarget(c: { universityId: string; departmentId: string; batchId: string }): Target {
  return { universityId: c.universityId, departmentIds: [c.departmentId], batchIds: [c.batchId] };
}

/** Holds `action` anywhere in the university (any scope). */
export function holdsAnywhere(actor: Actor, action: Action): boolean {
  const r = reach(actor, action, uni(actor));
  return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
}

/** Templates belong to the whole university, so changing them needs cert.manage university-wide (Institute Admin). */
export function canManageTemplates(actor: Actor): boolean {
  return can(actor, "cert.manage", { universityId: uni(actor) });
}

/** Staff who work with certificates anywhere may see the templates. */
export function canSeeTemplates(actor: Actor): boolean {
  return holdsAnywhere(actor, "cert.view") || holdsAnywhere(actor, "cert.manage");
}

/**
 * A where-clause limiting issued certificates to the actor's reach for `action`:
 * nothing extra for university-wide roles, own departments for HODs, own batches for faculty.
 */
export function certificateScope(actor: Actor, action: Action): SQL | undefined {
  const r = reach(actor, action, uni(actor));
  if (r.all) return undefined;
  const parts: SQL[] = [];
  if (r.departmentIds.size) parts.push(inArray(certCertificates.departmentId, [...r.departmentIds]));
  if (r.batchIds.size) parts.push(inArray(certCertificates.batchId, [...r.batchIds]));
  return parts.length ? or(...parts) : sql`false`;
}

/** Postgres unique violation, optionally on one constraint (drizzle keeps the driver error on `cause`). */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const pg = err?.cause?.code ? err.cause : err;
  return pg?.code === "23505" && (!constraint || pg.constraint_name === constraint);
}

export const trimmed = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
