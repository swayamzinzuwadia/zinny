import "server-only";
/**
 * Account changes made on someone's behalf by the Zinny team panel. Like sign-in itself,
 * this writes `users.password_hash` on the system connection (the brief's exception for
 * auth code), so module code never touches the core `users` table directly.
 *
 * No permission check here: the caller (`setPersonPassword` in the team panel) has
 * already checked that it is a Super Admin, and writes the audit entries.
 */
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword } from "./passwords";
import { revokeAllSessions } from "./session";

/**
 * Stores a new password for `userId` (already checked against the password rules) and,
 * when asked, ends their sessions. Returns how many sessions ended.
 */
export async function storePasswordFor(userId: string, password: string, opts: { signOutEverywhere: boolean; keepSessionId?: string | null }): Promise<number> {
  const passwordHash = await hashPassword(password);
  await systemDb().update(users).set({ passwordHash }).where(eq(users.id, userId));
  return opts.signOutEverywhere ? revokeAllSessions(userId, { except: opts.keepSessionId ?? null }) : 0;
}

/**
 * Stores a person's name, email and mobile. Same exception as above: `users` is a core
 * table, so the team panel's `updatePerson` (which checks Super Admin and logs) calls
 * this instead of writing it. Throws the database's unique violation if the email is taken.
 */
export async function storeProfileFor(userId: string, profile: { name: string; email: string; phone: string | null }): Promise<void> {
  await systemDb().update(users).set({ name: profile.name, email: profile.email, phone: profile.phone }).where(eq(users.id, userId));
}
