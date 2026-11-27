/**
 * Retention (Act s.8(7), Rule 8 and the Third Schedule). Each institute chooses how long an
 * inactive learner's account is kept (3 years by default) and whether the daily job only
 * flags such accounts for an admin or anonymises them itself. Either way the learner is told
 * first and given at least 48 hours (Rule 8(2)); signing in again clears the flag.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLog, domainEvents, roleAssignments, users } from "@/db/schema";
import { audit, notify, sendEmail, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { dpdpRetentionFlags, dpdpSettings } from "../schema";
import { DEFAULT_INACTIVE_DAYS, ERASURE_NOTICE_HOURS, isInactive, noticeServed } from "../lib/rules";
import { assertHandler, selfOf } from "./access";
import { eraseInInstitute } from "./erasure";

/** The grievance contact a learner sees: the institute's own when it set one, else null (Zinny's officer). */
export async function instituteGrievance(actor: Actor): Promise<{ name: string; email: string } | null> {
  selfOf(actor);
  const s = await withTenant(actor, settingsIn);
  return s.grievanceEmail ? { name: s.grievanceName ?? "Grievance officer", email: s.grievanceEmail } : null;
}

export type RetentionSettings = { inactiveDays: number; retentionAction: "flag" | "anonymise"; grievanceName: string | null; grievanceEmail: string | null };

const DEFAULTS: RetentionSettings = { inactiveDays: DEFAULT_INACTIVE_DAYS, retentionAction: "flag", grievanceName: null, grievanceEmail: null };

async function settingsIn(tx: Tx): Promise<RetentionSettings> {
  const [row] = await tx.select().from(dpdpSettings);
  return row ? { inactiveDays: row.inactiveDays, retentionAction: row.retentionAction, grievanceName: row.grievanceName, grievanceEmail: row.grievanceEmail } : DEFAULTS;
}

export async function getRetentionSettings(actor: Actor): Promise<RetentionSettings> {
  assertHandler(actor);
  return withTenant(actor, settingsIn);
}

export async function saveRetentionSettings(actor: Actor, input: { inactiveDays: number; retentionAction: string; grievanceName: string; grievanceEmail: string }) {
  const universityId = assertHandler(actor);
  if (!Number.isInteger(input.inactiveDays) || input.inactiveDays < 180 || input.inactiveDays > 3650) {
    throw new ValidationError("Choose a retention period between 180 days and 10 years.");
  }
  if (input.retentionAction !== "flag" && input.retentionAction !== "anonymise") throw new ValidationError("Choose what happens to inactive accounts.");
  const email = input.grievanceEmail.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address for your grievance contact, or leave it empty to use Zinny's.");
  const values = {
    inactiveDays: input.inactiveDays,
    retentionAction: input.retentionAction as "flag" | "anonymise",
    grievanceName: input.grievanceName.trim() || null,
    grievanceEmail: email || null,
    updatedBy: actor.userId || null,
    updatedAt: new Date(),
  };
  await withTenant(actor, async (tx) => {
    await tx.insert(dpdpSettings).values({ universityId, ...values }).onConflictDoUpdate({ target: dpdpSettings.universityId, set: values });
    await audit(tx, actor, "privacy.settings.update", "dpdp_settings", universityId, { inactiveDays: values.inactiveDays, retentionAction: values.retentionAction });
  });
}

/**
 * When each of the institute's learners (students, alumni, individual learners) was last
 * active here: the latest of their role starting, an enrolment, anything they did that was
 * logged, and anything they did that raised an event. Under row-level security.
 */
export async function lastActive(tx: Tx): Promise<{ userId: string; lastActiveAt: Date }[]> {
  const rows = await tx.execute<{ user_id: string; last: string }>(sql`
    select ra.user_id, greatest(
      max(ra.starts_at),
      (select max(a.at) from ${auditLog} a where a.actor_user_id = ra.user_id),
      (select max(e.occurred_at) from ${domainEvents} e where e.actor_user_id = ra.user_id or e.payload->>'userId' = ra.user_id::text)
    ) as last
    from ${roleAssignments} ra
    where ra.role in ('student', 'alumni', 'individual_learner') and ra.revoked_at is null
    group by ra.user_id`);
  return rows.map((r) => ({ userId: r.user_id, lastActiveAt: new Date(r.last) }));
}

/** `erased` lists the people anonymised in this run, so the job can sign them out everywhere after the commit. */
export type SweepResult = { flagged: number; cleared: number; anonymised: number; erased: string[] };

/**
 * The daily job, as the institute's system actor: flags learners inactive past the period
 * (and tells them), clears flags of anyone who came back, and when the institute chose
 * "anonymise", erases flagged accounts once the 48-hour notice has passed.
 */
export async function retentionSweep(actor: Actor, now = new Date()): Promise<SweepResult> {
  const universityId = assertHandler(actor);
  const result: SweepResult = { flagged: 0, cleared: 0, anonymised: 0, erased: [] };
  const toEmail: { email: string; name: string }[] = [];
  await withTenant(actor, async (tx) => {
    const s = await settingsIn(tx);
    const activity = await lastActive(tx);
    const open = await tx.select().from(dpdpRetentionFlags).where(isNull(dpdpRetentionFlags.resolvedAt));
    const openBy = new Map(open.map((f) => [f.userId, f]));
    const fresh: string[] = [];
    for (const a of activity) {
      const flag = openBy.get(a.userId);
      if (isInactive(a.lastActiveAt, s.inactiveDays, now)) {
        if (!flag) {
          await tx.insert(dpdpRetentionFlags).values({ universityId, userId: a.userId, lastActiveAt: a.lastActiveAt, flaggedAt: now });
          fresh.push(a.userId);
          result.flagged++;
        } else if (s.retentionAction === "anonymise" && noticeServed(flag.flaggedAt, now)) {
          const erased = await eraseInInstitute(tx, actor, a.userId, now);
          if (erased.anonymised) result.erased.push(a.userId);
          await tx.update(dpdpRetentionFlags).set({ resolvedAt: now, outcome: "anonymised" }).where(eq(dpdpRetentionFlags.id, flag.id));
          result.anonymised++;
        }
      } else if (flag) {
        await tx.update(dpdpRetentionFlags).set({ resolvedAt: now, outcome: "kept" }).where(eq(dpdpRetentionFlags.id, flag.id));
        result.cleared++;
      }
    }
    if (fresh.length) {
      const title = s.retentionAction === "anonymise" ? "Your account will be erased unless you sign in" : "Your account has been inactive for a long time";
      const body =
        s.retentionAction === "anonymise"
          ? `You haven't used your account in a long time, so under our retention policy it will be anonymised in ${ERASURE_NOTICE_HOURS} hours or more. Sign in to keep it.`
          : "You haven't used your account in a long time. Your institute may close it under its retention policy. Sign in to keep it.";
      await notify(tx, universityId, fresh, { kind: "privacy.retention", title, body });
      toEmail.push(...(await tx.select({ email: users.email, name: users.name }).from(users).where(inArray(users.id, fresh))).filter((u) => !u.email.endsWith("@erased.invalid")));
      await audit(tx, actor, "privacy.retention.flag", "dpdp_retention_flags", null, { count: fresh.length });
      for (const u of toEmail) {
        await sendEmail({ to: u.email, subject: title, text: `Hello ${u.name}, ${body}`, html: `<p>Hello ${u.name},</p><p>${body}</p>`, kind: "privacy.retention", universityId });
      }
    }
    if (result.anonymised || result.cleared) await audit(tx, actor, "privacy.retention.sweep", "dpdp_retention_flags", null, { flagged: result.flagged, cleared: result.cleared, anonymised: result.anonymised });
  });
  return result;
}

export type FlagRow = { id: string; userId: string; name: string; email: string; lastActiveAt: Date; flaggedAt: Date };

export async function listRetentionFlags(actor: Actor): Promise<FlagRow[]> {
  assertHandler(actor);
  return withTenant(actor, (tx) =>
    tx
      .select({ id: dpdpRetentionFlags.id, userId: dpdpRetentionFlags.userId, name: users.name, email: users.email, lastActiveAt: dpdpRetentionFlags.lastActiveAt, flaggedAt: dpdpRetentionFlags.flaggedAt })
      .from(dpdpRetentionFlags)
      .innerJoin(users, eq(users.id, dpdpRetentionFlags.userId))
      .where(isNull(dpdpRetentionFlags.resolvedAt))
      .orderBy(dpdpRetentionFlags.lastActiveAt),
  );
}

/** An admin decides about one flagged account: keep it, or anonymise it now (after the notice period). */
export async function resolveRetentionFlag(actor: Actor, flagId: string, outcome: "kept" | "anonymised", now = new Date()) {
  assertHandler(actor);
  if (!/^[0-9a-f-]{36}$/i.test(flagId)) throw new NotFoundError("Flag");
  return withTenant(actor, async (tx) => {
    const [flag] = await tx.select().from(dpdpRetentionFlags).where(and(eq(dpdpRetentionFlags.id, flagId), isNull(dpdpRetentionFlags.resolvedAt)));
    if (!flag) throw new NotFoundError("Flag");
    if (outcome === "anonymised") {
      if (!noticeServed(flag.flaggedAt, now)) throw new ValidationError(`The learner was told ${ERASURE_NOTICE_HOURS} hours before erasure; wait until that has passed.`);
      await eraseInInstitute(tx, actor, flag.userId, now);
    }
    await tx.update(dpdpRetentionFlags).set({ resolvedAt: now, outcome }).where(eq(dpdpRetentionFlags.id, flag.id));
    await audit(tx, actor, `privacy.retention.${outcome}`, "dpdp_retention_flags", flag.id, { userId: flag.userId });
  });
}

