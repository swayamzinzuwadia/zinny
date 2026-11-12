import "server-only";
/**
 * "Sign in as": a Zinny Super Admin becoming one account from the team panel, with that
 * person's full permissions. Asked for by the owner, so the team can fix things from
 * inside any account. The rules that keep it safe all live here and in `resolveSession`:
 *
 *  - Only an active platform Super Admin can start one, checked against the database,
 *    not against whatever the caller says. Never as yourself, and never from inside one.
 *  - It is a real session for the target, marked with `impersonator_user_id`, that lasts
 *    two hours and is never extended. It stops resolving the moment the Super Admin's
 *    role ends.
 *  - The Super Admin's own session is not ended. Its token moves to a second httpOnly
 *    cookie, and "Return to the Zinny panel" (or signing out) puts it back. That cookie
 *    is only ever accepted as what it is: a live, ordinary session token. When the
 *    "sign in as" session is known, it must also belong to the Super Admin who started it.
 *  - Start and stop are written to the platform log and to every institute the target
 *    belongs to. Everything done in between is logged as the target with
 *    `data.impersonatedBy` (see `audit` in ../tenant.ts).
 */
import { cookies } from "next/headers";
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { auditLog, roleAssignments, sessions, users } from "@/db/schema";
import { idnSessions } from "@/modules/identity/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { AUTH } from "./config";
import { clientInfo, cookieOptions, destroySessionByToken, resolveSession, sessionCookieName, type ClientInfo, type CookieJar } from "./session";
import { randomToken, sha256 } from "./tokens";

/** A "sign in as" session ends two hours after it starts, however active. */
export const IMPERSONATION_MS = 2 * 60 * 60_000;

/** `idn_sessions.method` of a "sign in as" session. */
export const IMPERSONATION_METHOD = "impersonation";

const secureCookies = () => process.env.NODE_ENV === "production";

/** Holds the Super Admin's own session token while they are signed in as someone. */
export const returnCookieName = () => (secureCookies() ? "__Host-zinny_return" : "zinny_return");

/** Role start times come from the database's clock; allow the same moment of skew the permission engine does. */
const CLOCK_SKEW_MS = 5_000;

/** Holds the platform Super Admin role right now (not revoked, started, not ended). */
export async function isActiveSuperAdmin(userId: string, now = new Date()): Promise<boolean> {
  const [row] = await systemDb()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.scopeType, "platform"),
        eq(roleAssignments.role, "super_admin"),
        isNull(roleAssignments.revokedAt),
        lte(roleAssignments.startsAt, new Date(now.getTime() + CLOCK_SKEW_MS)),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    )
    .limit(1);
  return !!row;
}

async function jarOf(jar?: CookieJar): Promise<CookieJar> {
  return jar ?? ((await cookies()) as unknown as CookieJar);
}

/** Writes start or stop to the platform log and to each of the target's institutes. Never throws. */
async function logImpersonation(action: "plat.impersonate.start" | "plat.impersonate.stop", adminUserId: string, targetUserId: string, data: Record<string, unknown>) {
  try {
    const db = systemDb();
    const [target] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, targetUserId));
    const institutes = await db
      .selectDistinct({ universityId: roleAssignments.universityId })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, targetUserId), isNull(roleAssignments.revokedAt), isNotNull(roleAssignments.universityId)));
    const details = { ...data, name: target?.name ?? null, email: target?.email ?? null };
    const row = (universityId: string | null) => ({
      universityId,
      actorUserId: adminUserId,
      supportSessionId: null,
      action,
      entity: "user",
      entityId: targetUserId,
      data: universityId ? { universityId, ...details } : details,
    });
    await db.insert(auditLog).values([row(null), ...institutes.map((i) => row(i.universityId))]);
  } catch (e) {
    console.error(`[auth] couldn't write ${action} to the audit log:`, e);
  }
}

export type Impersonation = { sessionId: string; adminUserId: string; targetUserId: string; expiresAt: Date };

/**
 * Signs this browser in as `targetUserId`, keeping the Super Admin's own session to come
 * back to. Call from a server action. Throws when the caller isn't an active Super Admin,
 * is already signed in as someone, or picks themselves.
 */
export async function beginImpersonation(targetUserId: string, opts: { jar?: CookieJar; client?: ClientInfo; now?: Date } = {}): Promise<Impersonation> {
  const jar = await jarOf(opts.jar);
  const now = opts.now ?? new Date();
  let ownToken = jar.get(sessionCookieName())?.value;
  let own = ownToken ? await resolveSession(ownToken, now) : null;
  if (own?.impersonatorUserId) throw new ConflictError("You're already signed in as someone. Return to the Zinny panel first, then sign in as the next person.");
  if (!own) {
    // An earlier "sign in as" ran out: their own session is waiting in the return cookie.
    ownToken = jar.get(returnCookieName())?.value;
    own = ownToken ? await resolveSession(ownToken, now) : null;
    if (own?.impersonatorUserId) own = null;
  }
  if (!own || !ownToken) throw new ForbiddenError("Sign in again to do this.");
  const adminUserId = own.userId;
  if (!(await isActiveSuperAdmin(adminUserId, now))) throw new ForbiddenError("Only a Super Admin can sign in as someone else.");
  if (adminUserId === targetUserId) throw new ValidationError("That's your own account. Pick someone else to sign in as.");
  const db = systemDb();
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId));
  if (!target) throw new NotFoundError("Person");

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + IMPERSONATION_MS);
  const client = opts.client ?? (await clientInfo());
  const sessionId = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(sessions)
      .values({ tokenHash: sha256(token), userId: targetUserId, expiresAt, createdAt: now, impersonatorUserId: adminUserId })
      .returning({ id: sessions.id });
    await tx.insert(idnSessions).values({ sessionId: s.id, userId: targetUserId, method: IMPERSONATION_METHOD, ip: client.ip, userAgent: client.userAgent, lastSeenAt: now });
    return s.id;
  });
  await logImpersonation("plat.impersonate.start", adminUserId, targetUserId, { expiresAt: expiresAt.toISOString() });

  // The way back outlives the two hours, so an expired session still returns them to themselves.
  jar.set(returnCookieName(), ownToken, { ...cookieOptions(new Date(now.getTime() + AUTH.session.absoluteMs)), sameSite: "strict" });
  jar.set(sessionCookieName(), token, cookieOptions(expiresAt));
  return { sessionId, adminUserId, targetUserId, expiresAt };
}

export type EndedImpersonation = {
  /** This browser is back on the Super Admin's own session. */
  restored: boolean;
  /** Set when a "sign in as" session was found and ended. */
  adminUserId: string | null;
  targetUserId: string | null;
};

/**
 * Ends this browser's "sign in as" session and puts the Super Admin's own session back.
 * If their own session can't be restored (it ended, or the return cookie isn't theirs)
 * the browser is left signed out: never signed in as the target.
 *
 * `requireLive` is for signing out: only a session that is still running is "returned
 * from"; anything else is a plain sign-out of everything this browser holds.
 */
export async function endImpersonation(opts: { jar?: CookieJar; now?: Date; requireLive?: boolean } = {}): Promise<EndedImpersonation> {
  const jar = await jarOf(opts.jar);
  const now = opts.now ?? new Date();
  const db = systemDb();
  const mainToken = jar.get(sessionCookieName())?.value;
  const backToken = jar.get(returnCookieName())?.value;
  jar.delete(returnCookieName());

  const [row] = mainToken
    ? await db
        .select({ id: sessions.id, userId: sessions.userId, impersonatorUserId: sessions.impersonatorUserId, expiresAt: sessions.expiresAt, createdAt: sessions.createdAt, method: idnSessions.method })
        .from(sessions)
        .leftJoin(idnSessions, eq(idnSessions.sessionId, sessions.id))
        .where(eq(sessions.tokenHash, sha256(mainToken)))
    : [];
  const impersonation = row && (row.impersonatorUserId || row.method === IMPERSONATION_METHOD) ? row : null;
  const live = !!impersonation?.impersonatorUserId && impersonation.expiresAt > now && impersonation.createdAt.getTime() + IMPERSONATION_MS > now.getTime();
  // An ordinary session of their own in the main cookie: there is nothing to return from.
  const ordinary = !!row && !impersonation;

  if (impersonation) {
    await db.delete(sessions).where(eq(sessions.id, impersonation.id));
    if (impersonation.impersonatorUserId) await logImpersonation("plat.impersonate.stop", impersonation.impersonatorUserId, impersonation.userId, {});
  }

  const own = backToken ? await resolveSession(backToken, now) : null;
  const theirs = !!own && !own.impersonatorUserId && (!impersonation?.impersonatorUserId || impersonation.impersonatorUserId === own.userId);
  const restore = theirs && !ordinary && (!opts.requireLive || live);
  if (restore) {
    jar.set(sessionCookieName(), backToken!, cookieOptions(new Date(now.getTime() + AUTH.session.absoluteMs)));
  } else {
    // A plain sign-out ends their own session too. A token that isn't theirs is left alone.
    if (backToken && theirs) await destroySessionByToken(backToken);
    if (!ordinary) jar.delete(sessionCookieName());
  }
  return { restored: restore, adminUserId: impersonation?.impersonatorUserId ?? null, targetUserId: impersonation?.userId ?? null };
}
