import "server-only";
/**
 * Sessions: a random token in an httpOnly cookie, its SHA-256 in the core `sessions` table,
 * and how and where it signed in in `idn_sessions`.
 *
 *  - Every sign-in creates a new session id and token, and ends the one the browser had
 *    before (no session fixation).
 *  - Sliding expiry: a session ends after AUTH.session.idleMs without use, and never later
 *    than AUTH.session.absoluteMs after sign-in. The server enforces both; the cookie
 *    itself lives until the absolute limit, so it never needs rewriting while you browse.
 *  - Cookie flags: httpOnly, SameSite=Lax, path=/; in production also Secure with the
 *    __Host- prefix (no Domain attribute, so a subdomain can't set or read it).
 *
 * This file and the identity module's auth service are the only code allowed to use the
 * system connection for sign-in (brief exception): they write `sessions` and identity's
 * own global tables.
 */
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { roleAssignments, sessions, universities } from "@/db/schema";
import { idnSessions } from "@/modules/identity/schema";
import { AUTH } from "./config";
import { randomToken, sha256 } from "./tokens";

export { hashPassword } from "./passwords";

const secureCookies = () => process.env.NODE_ENV === "production";

/** "__Host-zinny_session" in production, "zinny_session" in development (plain http). */
export const sessionCookieName = () => (secureCookies() ? "__Host-zinny_session" : "zinny_session");

export type CookieOptions = { httpOnly: boolean; sameSite: "lax" | "strict"; secure: boolean; path: string; expires?: Date; maxAge?: number };

/** The part of Next's cookie store this file uses, so tests can pass a plain object. */
export type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): unknown;
  delete(name: string): unknown;
};

async function jarOf(jar?: CookieJar): Promise<CookieJar> {
  return jar ?? ((await cookies()) as unknown as CookieJar);
}

export function cookieOptions(expires?: Date): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", ...(expires ? { expires } : {}) };
}

export type SessionMethod = "password" | "phone" | "invite" | "reset" | "demo";
export type ClientInfo = { ip: string | null; userAgent: string | null };

/** The caller's IP and browser, from the request headers (Vercel sets x-forwarded-for). */
export async function clientInfo(): Promise<ClientInfo> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || h.get("x-real-ip")?.trim() || null;
    return { ip: ip ? ip.slice(0, 64) : null, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/* ───────────────────────────── Store (no cookies) ───────────────────────────── */

export type NewSession = { token: string; sessionId: string; expiresAt: Date; cookieExpires: Date };

/** Creates a session row and its device record. The token is returned once and never stored. */
export async function createSession(userId: string, method: SessionMethod, client: ClientInfo, now = new Date()): Promise<NewSession> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + AUTH.session.idleMs);
  const cookieExpires = new Date(now.getTime() + AUTH.session.absoluteMs);
  const sessionId = await systemDb().transaction(async (tx) => {
    const [s] = await tx.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt, createdAt: now }).returning({ id: sessions.id });
    await tx.insert(idnSessions).values({
      sessionId: s.id,
      userId,
      method,
      ip: client.ip,
      userAgent: client.userAgent,
      lastSeenAt: now,
    });
    return s.id;
  });
  return { token, sessionId, expiresAt, cookieExpires };
}

export type ResolvedSession = { sessionId: string; userId: string };

/**
 * The live session for a token, or null. Extends the idle expiry (at most every
 * AUTH.session.touchEveryMs), never past the absolute limit.
 */
export async function resolveSession(token: string, now = new Date()): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  const db = systemDb();
  const [s] = await db
    .select({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)));
  if (!s) return null;
  const hardEnd = s.createdAt.getTime() + AUTH.session.absoluteMs;
  if (hardEnd <= now.getTime()) return null;

  const wanted = Math.min(now.getTime() + AUTH.session.idleMs, hardEnd);
  if (wanted - s.expiresAt.getTime() >= AUTH.session.touchEveryMs) {
    await db.update(sessions).set({ expiresAt: new Date(wanted) }).where(eq(sessions.id, s.id));
    await db.update(idnSessions).set({ lastSeenAt: now }).where(eq(idnSessions.sessionId, s.id));
  }
  return { sessionId: s.id, userId: s.userId };
}

export async function destroySessionByToken(token: string): Promise<void> {
  await systemDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Ends one of this person's sessions. Returns false when it isn't theirs or is already gone. */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const gone = await systemDb()
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return gone.length > 0;
}

/** Ends every session of this person, except `except` when given. Returns how many ended. */
export async function revokeAllSessions(userId: string, opts: { except?: string | null } = {}): Promise<number> {
  const gone = await systemDb()
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), opts.except ? ne(sessions.id, opts.except) : undefined))
    .returning({ id: sessions.id });
  return gone.length;
}

export type SessionInfo = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  method: string;
  ip: string | null;
  userAgent: string | null;
};

/** This person's live sessions, most recently used first. */
export async function listSessions(userId: string, now = new Date()): Promise<SessionInfo[]> {
  const rows = await systemDb()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastSeenAt: idnSessions.lastSeenAt,
      method: idnSessions.method,
      ip: idnSessions.ip,
      userAgent: idnSessions.userAgent,
    })
    .from(sessions)
    .leftJoin(idnSessions, eq(idnSessions.sessionId, sessions.id))
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now), gt(sessions.createdAt, new Date(now.getTime() - AUTH.session.absoluteMs))))
    .orderBy(desc(sql`coalesce(${idnSessions.lastSeenAt}, ${sessions.createdAt})`));
  return rows.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt ?? r.createdAt, method: r.method ?? "password" }));
}

/** Housekeeping: deletes sessions that ended (idle or absolute). */
export async function pruneSessions(now = new Date()): Promise<number> {
  const gone = await systemDb()
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, now), lt(sessions.createdAt, new Date(now.getTime() - AUTH.session.absoluteMs))))
    .returning({ id: sessions.id });
  return gone.length;
}

/** This token's session, if it is this person's and was made in the last moments. */
async function freshSession(token: string, userId: string, now: Date): Promise<NewSession | null> {
  const [s] = await systemDb()
    .select({ id: sessions.id, expiresAt: sessions.expiresAt, createdAt: sessions.createdAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, now),
        gt(sessions.createdAt, new Date(now.getTime() - AUTH.session.repeatSignInMs)),
      ),
    );
  if (!s) return null;
  return { token, sessionId: s.id, expiresAt: s.expiresAt, cookieExpires: new Date(s.createdAt.getTime() + AUTH.session.absoluteMs) };
}

/* ───────────────────────────── Cookies ───────────────────────────── */

/**
 * Signs this browser in as `userId`: ends the session it had (if any), starts a new one
 * with a new id, and sets the cookie. Call from a server action or route handler.
 */
export async function startSession(
  userId: string,
  method: SessionMethod = "password",
  opts: { jar?: CookieJar; client?: ClientInfo; now?: Date; keepFresh?: boolean } = {},
): Promise<NewSession> {
  const jar = await jarOf(opts.jar);
  const name = sessionCookieName();
  const previous = jar.get(name)?.value;
  if (previous) {
    // A double click signs in twice. Ending the session the first click just made would
    // leave the browser on a dead session, and the next page would send it to sign-in.
    const fresh = opts.keepFresh ? await freshSession(previous, userId, opts.now ?? new Date()) : null;
    if (fresh) return fresh;
    await destroySessionByToken(previous);
  }
  const s = await createSession(userId, method, opts.client ?? (await clientInfo()), opts.now);
  jar.set(name, s.token, cookieOptions(s.cookieExpires));
  return s;
}

/** Ends this browser's session and clears the cookie. */
export async function signOut(opts: { jar?: CookieJar } = {}) {
  const jar = await jarOf(opts.jar);
  const name = sessionCookieName();
  const token = jar.get(name)?.value;
  if (token) await destroySessionByToken(token);
  jar.delete(name);
}

/** The signed-in session (id and person), or null. Cached for the duration of one request. */
export const currentSession = cache(async (): Promise<ResolvedSession | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  return resolveSession(token);
});

/** The signed-in user's id, or null. Cached for the duration of one request. */
export const currentUserId = cache(async (): Promise<string | null> => (await currentSession())?.userId ?? null);

/* ───────────────────────────── Spaces ───────────────────────────── */

/** Universities this person belongs to, with their roles there — for the space picker after sign-in. */
export async function spacesFor(userId: string) {
  const rows = await systemDb()
    .select({ role: roleAssignments.role, endsAt: roleAssignments.endsAt, slug: universities.slug, name: universities.name, id: universities.id })
    .from(roleAssignments)
    .innerJoin(universities, eq(universities.id, roleAssignments.universityId))
    .where(and(eq(roleAssignments.userId, userId), isNull(roleAssignments.revokedAt)));
  const now = new Date();
  const map = new Map<string, { id: string; slug: string; name: string; roles: Set<string> }>();
  for (const r of rows) {
    if (r.endsAt && r.endsAt <= now) continue;
    const s = map.get(r.slug) ?? { id: r.id, slug: r.slug, name: r.name, roles: new Set<string>() };
    s.roles.add(r.role);
    map.set(r.slug, s);
  }
  return [...map.values()].map((s) => ({ ...s, roles: [...s.roles] }));
}

/** Session ids that still exist, of those given (used to show "signed out" after revoking). */
export async function liveSessionIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await systemDb().select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, ids));
  return new Set(rows.map((r) => r.id));
}
