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
 *  - A session started with a phone code is bound to the institute the code was entered at
 *    (`scopeUniversityId`). A mobile number can be typed in by an institute's admin, not
 *    only confirmed by its owner, so it proves nothing outside that institute: there the
 *    session counts as signed out (currentUserId, spaceContext) and grants no roles
 *    (loadActor). A phone session that doesn't know its institute opens nothing.
 *
 *  - A Zinny Super Admin can sign in as someone from the team panel (./impersonation.ts).
 *    That session carries `impersonator_user_id`, lasts two hours at most, never slides,
 *    and stops working the moment the Super Admin stops being one.
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
import { IMPERSONATION_METHOD, IMPERSONATION_MS, endImpersonation, isActiveSuperAdmin, returnCookieName } from "./impersonation";
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

/** How many proxies in front of the app append to x-forwarded-for (TRUSTED_PROXY_HOPS, default 1). */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
}

/**
 * The caller's IP from the request headers. Each proxy appends the address it got the request
 * from to x-forwarded-for, so only the entries our own proxies added can be trusted: the one
 * `hops` from the right. Anything to its left was sent by the caller and is ignored, so nobody
 * can dodge (or set off) another network's sign-in limits by sending the header themselves.
 * Vercel replaces the header with the caller's address alone; an AWS load balancer appends it.
 */
export function clientIpFrom(h: { get(name: string): string | null }, hops = trustedProxyHops()): string | null {
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain.length > 0 ? chain[Math.max(0, chain.length - hops)] : h.get("x-real-ip")?.trim() || null;
  return ip ? ip.slice(0, 64) : null;
}

/** The caller's IP and browser, from the request headers. */
export async function clientInfo(): Promise<ClientInfo> {
  try {
    const h = await headers();
    return { ip: clientIpFrom(h), userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/* ───────────────────────────── Store (no cookies) ───────────────────────────── */

export type NewSession = { token: string; sessionId: string; expiresAt: Date; cookieExpires: Date };

/**
 * Creates a session row and its device record. The token is returned once and never stored.
 * A phone-code session names the institute it is for (`scopeUniversityId`); one that doesn't
 * is bound to no institute at all (see resolveSession).
 */
export async function createSession(
  userId: string,
  method: SessionMethod,
  client: ClientInfo,
  now = new Date(),
  opts: { scopeUniversityId?: string | null } = {},
): Promise<NewSession> {
  const scopeUniversityId = opts.scopeUniversityId ?? null;
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
      scopeUniversityId,
    });
    return s.id;
  });
  return { token, sessionId, expiresAt, cookieExpires };
}

/** The scope of a phone-code session that doesn't know its institute: no institute has this id. */
export const NO_INSTITUTE = "00000000-0000-0000-0000-000000000000";

export type ResolvedSession = {
  sessionId: string;
  userId: string;
  /** The Super Admin really behind this session, when it is a "sign in as" session. */
  impersonatorUserId: string | null;
  /** Present for a phone-code session: the only institute it counts in. */
  scopeUniversityId?: string;
};

/**
 * The live session for a token, or null. Extends the idle expiry (at most every
 * AUTH.session.touchEveryMs), never past the absolute limit.
 */
export async function resolveSession(token: string, now = new Date()): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  const db = systemDb();
  const [s] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
      impersonatorUserId: sessions.impersonatorUserId,
      method: idnSessions.method,
      scopeUniversityId: idnSessions.scopeUniversityId,
    })
    .from(sessions)
    .leftJoin(idnSessions, eq(idnSessions.sessionId, sessions.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)));
  if (!s) return null;

  // A phone-code session that doesn't know its institute (one made before sessions were
  // bound) is bound to none: it opens nothing until the person signs in again.
  const scopeUniversityId = s.scopeUniversityId ?? (s.method === "phone" ? NO_INSTITUTE : null);

  if (s.impersonatorUserId || s.method === IMPERSONATION_METHOD) {
    // A "sign in as" session: two hours from when it started, never extended, and only
    // while the person behind it is still a Super Admin. If their account is deleted the
    // column is cleared; the method still marks the session, so it can never turn into an
    // ordinary session of the person they were signed in as.
    const live = !!s.impersonatorUserId && s.createdAt.getTime() + IMPERSONATION_MS > now.getTime() && (await isActiveSuperAdmin(s.impersonatorUserId, now));
    if (!live) {
      await db.delete(sessions).where(eq(sessions.id, s.id));
      return null;
    }
    return { sessionId: s.id, userId: s.userId, impersonatorUserId: s.impersonatorUserId };
  }

  const hardEnd = s.createdAt.getTime() + AUTH.session.absoluteMs;
  if (hardEnd <= now.getTime()) return null;

  const wanted = Math.min(now.getTime() + AUTH.session.idleMs, hardEnd);
  if (wanted - s.expiresAt.getTime() >= AUTH.session.touchEveryMs) {
    await db.update(sessions).set({ expiresAt: new Date(wanted) }).where(eq(sessions.id, s.id));
    await db.update(idnSessions).set({ lastSeenAt: now }).where(eq(idnSessions.sessionId, s.id));
  }
  return { sessionId: s.id, userId: s.userId, impersonatorUserId: null, ...(scopeUniversityId ? { scopeUniversityId } : {}) };
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

/**
 * This person's live sessions, most recently used first. Sessions a Zinny Super Admin
 * opened as them are left out: they aren't one of the person's devices, and they are in
 * the institute's audit log instead.
 */
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
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.impersonatorUserId),
        or(isNull(idnSessions.method), ne(idnSessions.method, IMPERSONATION_METHOD)),
        gt(sessions.expiresAt, now),
        gt(sessions.createdAt, new Date(now.getTime() - AUTH.session.absoluteMs)),
      ),
    )
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

/**
 * This token's session, if it is this person's, was made in the last moments, and is bound
 * to the same institute (or to none) as the sign-in asking for it.
 */
async function freshSession(token: string, userId: string, now: Date, scopeUniversityId: string | null): Promise<NewSession | null> {
  const [s] = await systemDb()
    .select({ id: sessions.id, expiresAt: sessions.expiresAt, createdAt: sessions.createdAt })
    .from(sessions)
    .innerJoin(idnSessions, eq(idnSessions.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        eq(sessions.userId, userId),
        isNull(sessions.impersonatorUserId),
        gt(sessions.expiresAt, now),
        gt(sessions.createdAt, new Date(now.getTime() - AUTH.session.repeatSignInMs)),
        scopeUniversityId ? eq(idnSessions.scopeUniversityId, scopeUniversityId) : isNull(idnSessions.scopeUniversityId),
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
  opts: { jar?: CookieJar; client?: ClientInfo; now?: Date; keepFresh?: boolean; scopeUniversityId?: string | null } = {},
): Promise<NewSession> {
  const jar = await jarOf(opts.jar);
  const name = sessionCookieName();
  const previous = jar.get(name)?.value;
  const scope = opts.scopeUniversityId ?? null;
  if (previous) {
    // A double click signs in twice. Ending the session the first click just made would
    // leave the browser on a dead session, and the next page would send it to sign-in.
    const fresh = opts.keepFresh ? await freshSession(previous, userId, opts.now ?? new Date(), scope) : null;
    if (fresh) return fresh;
    await destroySessionByToken(previous);
  }
  // A new sign-in replaces everything this browser held, a Super Admin's way back included.
  const back = jar.get(returnCookieName())?.value;
  if (back) {
    await destroySessionByToken(back);
    jar.delete(returnCookieName());
  }
  const s = await createSession(userId, method, opts.client ?? (await clientInfo()), opts.now, { scopeUniversityId: scope });
  jar.set(name, s.token, cookieOptions(s.cookieExpires));
  return s;
}

/**
 * Ends this browser's session and clears the cookie. A Super Admin signed in as someone
 * goes back to their own session instead (the same as "Return to the Zinny panel").
 */
export async function signOut(opts: { jar?: CookieJar } = {}) {
  const jar = await jarOf(opts.jar);
  if (jar.get(returnCookieName())?.value) {
    const { restored } = await endImpersonation({ jar, requireLive: true });
    if (restored) return;
  }
  const name = sessionCookieName();
  const token = jar.get(name)?.value;
  if (token) await destroySessionByToken(token);
  jar.delete(name);
}

/**
 * The live session behind this browser's cookies, or null. When a "sign in as" session
 * has run out, the Super Admin's own session (kept in the return cookie) counts again:
 * they are themselves, never the person they were signed in as.
 */
export async function sessionFromCookies(jar: Pick<CookieJar, "get">, now = new Date()): Promise<ResolvedSession | null> {
  const token = jar.get(sessionCookieName())?.value;
  const session = token ? await resolveSession(token, now) : null;
  if (session) return session;
  const back = jar.get(returnCookieName())?.value;
  if (!back) return null;
  const own = await resolveSession(back, now);
  return own && !own.impersonatorUserId ? own : null;
}

/** The signed-in session (id and person), or null. Cached for the duration of one request. */
export const currentSession = cache(async (): Promise<ResolvedSession | null> => sessionFromCookies((await cookies()) as unknown as CookieJar));

/**
 * The signed-in user's id, or null. Cached for the duration of one request. A phone-code
 * session counts only inside its own institute, which spaceContext checks through
 * currentSession; everywhere else (the space picker, the marketplace, /join, /privacy, the
 * Zinny panel) it is treated as signed out.
 */
export const currentUserId = cache(async (): Promise<string | null> => {
  const s = await currentSession();
  return s && !s.scopeUniversityId ? s.userId : null;
});

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

/**
 * The spaces this person belongs to, leaving out institutes they only bought from on the
 * marketplace. Those purchases live in My library, so they aren't a home to land in.
 */
export async function homeSpacesFor(userId: string) {
  return (await spacesFor(userId)).filter((s) => s.roles.some((r) => r !== "individual_learner"));
}

/** Session ids that still exist, of those given (used to show "signed out" after revoking). */
export async function liveSessionIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await systemDb().select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, ids));
  return new Set(rows.map((r) => r.id));
}
