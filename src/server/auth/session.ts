import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { roleAssignments, sessions, universities, users } from "@/db/schema";

const COOKIE = "zinny_session";
const SESSION_DAYS = 14;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function signIn(email: string, password: string): Promise<string | null> {
  const [user] = await systemDb().select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return null;
  await startSession(user.id);
  return user.id;
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await systemDb().insert(sessions).values({ tokenHash: hash(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await systemDb().delete(sessions).where(eq(sessions.tokenHash, hash(token)));
  jar.delete(COOKIE);
}

/** The signed-in user's id, or null. Cached for the duration of one request. */
export const currentUserId = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [s] = await systemDb()
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date())));
  return s?.userId ?? null;
});

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

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
