/** Zinny team panel: universities and support mode (PRD page 9). Runs on the system connection. */
import { and, desc, eq, isNull } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { auditLog, roleAssignments, supportSessions, universities, users } from "@/db/schema";
import { assertPlatform, type Actor } from "../authz/engine";
import { ValidationError } from "../errors";

const SUPPORT_SESSION_MINUTES = 120;

export async function enterSupportMode(actor: Actor, universityId: string, reason: string) {
  assertPlatform(actor, "platform.support_mode");
  if (reason.trim().length < 5) throw new ValidationError("Write a short reason for entering support mode.");
  const db = systemDb();
  return db.transaction(async (tx) => {
    // One open session per person per university.
    await tx
      .update(supportSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(supportSessions.staffUserId, actor.userId),
          eq(supportSessions.universityId, universityId),
          isNull(supportSessions.endedAt),
        ),
      );
    const [session] = await tx
      .insert(supportSessions)
      .values({
        staffUserId: actor.userId,
        universityId,
        reason: reason.trim(),
        expiresAt: new Date(Date.now() + SUPPORT_SESSION_MINUTES * 60_000),
      })
      .returning();
    await tx.insert(auditLog).values({
      universityId,
      actorUserId: actor.userId,
      supportSessionId: session.id,
      action: "support.enter",
      entity: "support_session",
      entityId: session.id,
      data: { reason: session.reason },
    });
    return session;
  });
}

export async function exitSupportMode(actor: Actor, sessionId: string) {
  const db = systemDb();
  const [session] = await db
    .update(supportSessions)
    .set({ endedAt: new Date() })
    .where(and(eq(supportSessions.id, sessionId), eq(supportSessions.staffUserId, actor.userId)))
    .returning();
  if (session) {
    await db.insert(auditLog).values({
      universityId: session.universityId,
      actorUserId: actor.userId,
      supportSessionId: session.id,
      action: "support.exit",
      entity: "support_session",
      entityId: session.id,
    });
  }
}

export async function listUniversities(actor: Actor) {
  assertPlatform(actor, "platform.support_mode");
  return systemDb().select().from(universities).orderBy(universities.name);
}

export async function createUniversity(
  actor: Actor,
  input: { name: string; slug: string; adminEmail: string; adminName: string; invoicePrefix?: string },
) {
  assertPlatform(actor, "platform.manage_universities");
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new ValidationError("Slug can use a–z, 0–9 and hyphens.");
  const db = systemDb();
  return db.transaction(async (tx) => {
    const [uni] = await tx
      .insert(universities)
      .values({ name: input.name.trim(), slug, invoicePrefix: (input.invoicePrefix ?? slug.slice(0, 4)).toUpperCase() })
      .returning();
    const [existing] = await tx.select().from(users).where(eq(users.email, input.adminEmail.toLowerCase()));
    const admin =
      existing ??
      (await tx.insert(users).values({ email: input.adminEmail.toLowerCase(), name: input.adminName }).returning())[0];
    await tx.insert(roleAssignments).values({
      userId: admin.id,
      role: "institute_admin",
      scopeType: "university",
      universityId: uni.id,
      createdBy: actor.userId,
    });
    await tx.insert(auditLog).values({
      universityId: uni.id,
      actorUserId: actor.userId,
      action: "university.create",
      entity: "university",
      entityId: uni.id,
      data: { name: uni.name, slug: uni.slug, admin: admin.email },
    });
    return uni;
  });
}

/** The support trail for one university: who entered, why, and what they changed. */
export async function supportTrail(actor: Actor, universityId: string, limit = 100) {
  assertPlatform(actor, "platform.support_mode");
  return systemDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.universityId, universityId)))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}
