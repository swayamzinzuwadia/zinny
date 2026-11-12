/**
 * What a Super Admin can do to any account from the team panel: set its password, and
 * sign in as it. Both are for Super Admins only, and both are written to the platform
 * log and to the log of every institute the person belongs to.
 */
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { roleAssignments, sessions, universities, users, type RoleName } from "@/db/schema";
import { beginImpersonation, endImpersonation, type Impersonation } from "@/server/auth/impersonation";
import { storePasswordFor } from "@/server/auth/admin";
import { checkNewPassword } from "@/server/auth/passwords";
import { currentSession, type ClientInfo, type CookieJar } from "@/server/auth/session";
import { ADMIN_PANEL_ROLES, ROLE_LABELS } from "@/server/authz/roles";
import type { Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertSuperAdmin } from "../lib/access";
import { PLATFORM_ROLE_LABELS, isPlatformRole } from "../lib/constants";
import { db, isUuid, logAction } from "./shared";

async function personOrThrow(userId: string) {
  if (!isUuid(userId)) throw new NotFoundError("Person");
  const [p] = await db().select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!p) throw new NotFoundError("Person");
  return p;
}

export type Membership = { role: RoleName; universityId: string | null; slug: string | null; universityName: string | null };

/** The roles this person holds right now, at institutes and on the Zinny team. */
async function activeRoles(userId: string, now = new Date()): Promise<Membership[]> {
  return db()
    .select({ role: roleAssignments.role, universityId: roleAssignments.universityId, slug: universities.slug, universityName: universities.name })
    .from(roleAssignments)
    .leftJoin(universities, eq(universities.id, roleAssignments.universityId))
    .where(
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.revokedAt),
        lte(roleAssignments.startsAt, new Date(now.getTime() + 5_000)),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    );
}

/* ─────────────────────────── Set password ─────────────────────────── */

export type SetPasswordInput = {
  password: string;
  confirm?: string;
  /** End every session the person has, so the old password's sign-ins stop working. On unless set to false. */
  signOutEverywhere?: boolean;
  /** A session to keep when signing out everywhere: the Super Admin's own, when it is their own password. */
  keepSessionId?: string | null;
};

/**
 * Sets a person's password (the usual password rules apply). The password is hashed and
 * never logged, returned or shown again. The entry in the logs says who set it and how
 * many sessions were ended, nothing more.
 */
export async function setPersonPassword(actor: Actor, userId: string, input: SetPasswordInput) {
  assertSuperAdmin(actor);
  const person = await personOrThrow(userId);
  const password = checkNewPassword(input.password, { email: person.email, name: person.name, confirm: input.confirm });
  const signOut = input.signOutEverywhere !== false;

  const institutes = await db()
    .selectDistinct({ universityId: roleAssignments.universityId })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), isNull(roleAssignments.revokedAt), isNotNull(roleAssignments.universityId)));

  // The auth layer writes the hash (users is a core table) and ends the sessions.
  const sessionsEnded = await storePasswordFor(userId, password, { signOutEverywhere: signOut, keepSessionId: userId === actor.userId ? input.keepSessionId : null });

  await db().transaction(async (tx) => {
    const data = { name: person.name, email: person.email, signedOutEverywhere: signOut, sessionsEnded };
    await logAction(tx, actor, {}, "plat.password.set", "user", userId, data);
    for (const i of institutes) await logAction(tx, actor, { universityId: i.universityId, inUniversityLog: true }, "plat.password.set", "user", userId, data);
  });
  return { name: person.name, sessionsEnded, signedOutEverywhere: signOut };
}

/* ─────────────────────────── Sign in as ─────────────────────────── */

/**
 * Where a person lands when they sign in: their institute's admin panel or learner app,
 * the marketplace, or the Zinny panel. With `universityId`, the place they have there.
 */
export async function landingFor(userId: string, universityId?: string | null): Promise<string> {
  const roles = await activeRoles(userId);
  const spaces = new Map<string, { slug: string; roles: RoleName[] }>();
  for (const r of roles) {
    if (!r.universityId || !r.slug) continue;
    const s = spaces.get(r.universityId) ?? { slug: r.slug, roles: [] };
    s.roles.push(r.role);
    spaces.set(r.universityId, s);
  }
  const pathFor = (s: { slug: string; roles: RoleName[] }) =>
    s.roles.some((r) => ADMIN_PANEL_ROLES.has(r)) ? `/${s.slug}/admin` : s.roles.every((r) => r === "individual_learner") ? "/marketplace/library" : `/${s.slug}/learn`;
  const here = universityId ? spaces.get(universityId) : undefined;
  if (here) return pathFor(here);
  // People who only bought on the marketplace have no institute to land in.
  const homes = [...spaces.values()].filter((s) => s.roles.some((r) => r !== "individual_learner"));
  const onTeam = roles.some((r) => !r.universityId && isPlatformRole(r.role));
  if (onTeam && homes.length === 0) return "/platform";
  if (!onTeam && homes.length === 1) return pathFor(homes[0]);
  if (homes.length === 0) return "/marketplace";
  return "/";
}

export type StartImpersonation = Impersonation & { landing: string; name: string };

/**
 * Signs the Super Admin in as this person, with the person's full permissions, for up to
 * two hours. Refused for anyone who isn't an active Super Admin, for your own account,
 * and while already signed in as someone. The session rules are enforced again in
 * `beginImpersonation`, against the database.
 */
export async function startImpersonation(
  actor: Actor,
  userId: string,
  opts: { universityId?: string | null; jar?: CookieJar; client?: ClientInfo; now?: Date } = {},
): Promise<StartImpersonation> {
  if (actor.impersonatedBy) throw new ConflictError("You're already signed in as someone. Return to the Zinny panel first, then sign in as the next person.");
  assertSuperAdmin(actor);
  if (userId === actor.userId) throw new ValidationError("That's your own account. Pick someone else to sign in as.");
  const person = await personOrThrow(userId);
  const universityId = opts.universityId && isUuid(opts.universityId) ? opts.universityId : null;
  const landing = await landingFor(userId, universityId);
  const started = await beginImpersonation(userId, { jar: opts.jar, client: opts.client, now: opts.now });
  return { ...started, landing, name: person.name };
}

/** Ends "sign in as" and returns to the Super Admin's own session. Where to go next comes back. */
export async function stopImpersonation(opts: { jar?: CookieJar; now?: Date } = {}) {
  const ended = await endImpersonation(opts);
  return { ...ended, next: ended.restored ? (ended.targetUserId ? `/platform/people/${ended.targetUserId}` : "/platform") : "/login" };
}

export type ImpersonationView = { name: string; role: string; adminName: string; expiresAt: Date };

/**
 * Who this request is signed in as, for the banner every layout shows. Null when the
 * session is an ordinary one. `slug` picks the institute the screen is in.
 */
export async function impersonationView(slug?: string | null): Promise<ImpersonationView | null> {
  const session = await currentSession();
  if (!session?.impersonatorUserId) return null;
  const conn = db();
  const [[who], [admin], [row], roles] = await Promise.all([
    conn.select({ name: users.name }).from(users).where(eq(users.id, session.userId)),
    conn.select({ name: users.name }).from(users).where(eq(users.id, session.impersonatorUserId)),
    conn.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, session.sessionId)),
    activeRoles(session.userId),
  ]);
  if (!who || !row) return null;
  return { name: who.name, role: describeRoles(roles, slug), adminName: admin?.name ?? "A Super Admin", expiresAt: row.expiresAt };
}

/** "Institute Admin at Demo University", "Student at Riverside College", "Support Agent on the Zinny team", "a marketplace learner". */
export function describeRoles(roles: Membership[], slug?: string | null): string {
  const at = roles.filter((r) => r.universityId);
  const pick = (slug && at.filter((r) => r.slug === slug)) || [];
  const group = pick.length ? pick : at.filter((r) => r.universityId === at[0]?.universityId);
  if (group.length) {
    // The role that decides where they work: an admin-panel role before a learner one.
    const main = group.find((r) => ADMIN_PANEL_ROLES.has(r.role)) ?? group[0];
    if (group.every((r) => r.role === "individual_learner")) return "a marketplace learner";
    return `${ROLE_LABELS[main.role]} at ${main.universityName}`;
  }
  const team = roles.find((r) => !r.universityId && isPlatformRole(r.role));
  if (team && isPlatformRole(team.role)) return `${PLATFORM_ROLE_LABELS[team.role]} on the Zinny team`;
  return "a marketplace learner";
}
