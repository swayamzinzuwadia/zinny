/**
 * Consent records (Act s.6, Rule 3). Each purpose is consented to on its own. Account and
 * service come with having an account; news and analytics are optional, off by default, and
 * switched off with one tap (s.6(4): withdrawing is as easy as giving).
 *
 * Rows with a university belong to that institute (withTenant); rows without one are Zinny's
 * own (services/system.ts), always limited to the signed-in person.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { users } from "@/db/schema";
import { withTenant, type Actor } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { dpdpConsents } from "../schema";
import { ESSENTIAL_PURPOSES, NOTICE_VERSION, OPTIONAL_PURPOSES, type Purpose } from "../lib/rules";
import { ipHash } from "../lib/hash";
import { assertHandler, selfOf } from "./access";
import { minorState } from "./children";
import { zinny, zinnyAudit, zinnyTx } from "./system";

export type ConsentRow = typeof dpdpConsents.$inferSelect;

/** Inserts a live consent unless one is already live for that person, purpose and fiduciary. */
async function insertConsent(tx: Tx, row: { universityId: string | null; userId: string; purpose: Purpose; source: string; ip: string | null; now?: Date }) {
  const [created] = await tx
    .insert(dpdpConsents)
    .values({ universityId: row.universityId, userId: row.userId, purpose: row.purpose, noticeVersion: NOTICE_VERSION, grantedAt: row.now ?? new Date(), source: row.source, ipHash: ipHash(row.ip) })
    .onConflictDoNothing()
    .returning();
  return created ?? null;
}

/** Inside an institute: its rows (withTenant). Outside: Zinny's rows. Plus Zinny's rows either way, for reading. */
async function inScope<T>(actor: Actor, universityId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return universityId ? withTenant(actor, fn) : zinnyTx(fn);
}

/** The person's consents: this institute's (when inside one) and Zinny's own, newest first. */
export async function myConsents(actor: Actor): Promise<(ConsentRow & { fiduciary: "institute" | "zinny" })[]> {
  const me = selfOf(actor);
  const [here, ours] = await Promise.all([
    me.universityId ? withTenant(actor, (tx) => tx.select().from(dpdpConsents).where(eq(dpdpConsents.userId, me.userId)).orderBy(desc(dpdpConsents.grantedAt))) : Promise.resolve([]),
    zinny()
      .select()
      .from(dpdpConsents)
      .where(and(eq(dpdpConsents.userId, me.userId), isNull(dpdpConsents.universityId)))
      .orderBy(desc(dpdpConsents.grantedAt)),
  ]);
  return [...here.map((r) => ({ ...r, fiduciary: "institute" as const })), ...ours.map((r) => ({ ...r, fiduciary: "zinny" as const }))];
}

/**
 * Switches on an optional purpose (news, analytics). A learner under 18 can't until a parent
 * or guardian has confirmed (s.9). `zinnyWide` puts it on Zinny's own record instead of the institute's.
 */
export async function grantConsent(actor: Actor, purpose: Purpose, opts: { ip: string | null; zinnyWide?: boolean }) {
  const me = selfOf(actor);
  if (!OPTIONAL_PURPOSES.includes(purpose)) throw new ValidationError("That consent can't be switched on here.");
  const minor = await minorState(me.userId);
  if (minor.minor && !minor.verified) {
    throw new ForbiddenError("This needs your parent or guardian's consent first. Ask them to open the link we sent them.");
  }
  const universityId = opts.zinnyWide ? null : me.universityId;
  return inScope(actor, universityId, async (tx) => {
    const row = await insertConsent(tx, { universityId, userId: me.userId, purpose, source: "profile", ip: opts.ip });
    if (row) await zinnyAudit(tx, actor, universityId, "privacy.consent.grant", "dpdp_consents", row.id, { purpose, noticeVersion: NOTICE_VERSION });
    return row;
  });
}

/** Withdraws one of the person's own consents. Account and service can only end with erasure. */
export async function withdrawConsent(actor: Actor, consentId: string, now = new Date()) {
  const me = selfOf(actor);
  if (!/^[0-9a-f-]{36}$/i.test(consentId)) throw new NotFoundError("Consent");
  // Look in this institute's rows first, then Zinny's own.
  const find = async (tx: Tx) => (await tx.select().from(dpdpConsents).where(and(eq(dpdpConsents.id, consentId), eq(dpdpConsents.userId, me.userId))))[0];
  let universityId: string | null = me.universityId;
  let row = me.universityId ? await withTenant(actor, find) : undefined;
  if (!row) {
    universityId = null;
    row = await zinnyTx(async (tx) => {
      const r = await find(tx);
      return r && r.universityId === null ? r : undefined;
    });
  }
  if (!row) throw new NotFoundError("Consent");
  if (row.withdrawnAt) return row;
  if (ESSENTIAL_PURPOSES.includes(row.purpose)) {
    throw new ValidationError("Your account can't run without this. To stop all processing, ask for your account to be erased below.");
  }
  return inScope(actor, universityId, async (tx) => {
    const [done] = await tx.update(dpdpConsents).set({ withdrawnAt: now }).where(and(eq(dpdpConsents.id, row.id), isNull(dpdpConsents.withdrawnAt))).returning();
    await zinnyAudit(tx, actor, universityId, "privacy.consent.withdraw", "dpdp_consents", row.id, { purpose: row.purpose });
    return done ?? row;
  });
}

export type SignupConsents = { marketing: boolean };

/**
 * Consents given on a sign-up form, recorded right after the account is made. `actor` is the
 * new account's own (loadActor(userId, null)): only its own records are written. Account and
 * service are what the form requires; news only when ticked. When the person joins an
 * institute, the same consents are recorded for that institute too, since it is their Data
 * Fiduciary from then on.
 */
export async function recordSignupConsents(
  actor: Actor,
  opts: { source: "institute_signup" | "student_signup"; consents: SignupConsents; ip: string | null; instituteId?: string | null },
) {
  const me = selfOf(actor);
  const purposes: Purpose[] = ["account", "service", ...(opts.consents.marketing ? (["marketing"] as const) : [])];
  await zinnyTx(async (tx) => {
    // A brand-new account only: this can't be used to write consents for anyone else later.
    const [u] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, me.userId));
    if (!u || Date.now() - u.createdAt.getTime() > 60 * 60_000) throw new ForbiddenError();
    for (const universityId of [null, ...(opts.instituteId ? [opts.instituteId] : [])]) {
      for (const purpose of purposes) {
        const row = await insertConsent(tx, { universityId, userId: me.userId, purpose, source: opts.source, ip: opts.ip });
        if (row) await zinnyAudit(tx, actor, universityId, "privacy.consent.grant", "dpdp_consents", row.id, { purpose, source: opts.source, noticeVersion: NOTICE_VERSION });
      }
    }
  });
}

/** KYC: the institute's own record of the consent its KYC form asks for. Called once the KYC is saved. */
export async function recordKycConsent(actor: Actor, opts: { ip: string | null }) {
  const me = selfOf(actor);
  if (!me.universityId) throw new ForbiddenError("No institute selected.");
  await withTenant(actor, async (tx) => {
    const row = await insertConsent(tx, { universityId: me.universityId, userId: me.userId, purpose: "kyc", source: "kyc", ip: opts.ip });
    if (row) await zinnyAudit(tx, actor, me.universityId, "privacy.consent.grant", "dpdp_consents", row.id, { purpose: "kyc", noticeVersion: NOTICE_VERSION });
  });
}

/* ─────────────────────────── For the institute ─────────────────────────── */

export type ConsentSummary = { purpose: Purpose; live: number; withdrawn: number };

/** How many of the institute's learners hold each consent, and how many withdrew. */
export async function consentSummary(actor: Actor): Promise<ConsentSummary[]> {
  assertHandler(actor);
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        purpose: dpdpConsents.purpose,
        live: sql<number>`count(*) filter (where ${dpdpConsents.withdrawnAt} is null)`.mapWith(Number),
        withdrawn: sql<number>`count(*) filter (where ${dpdpConsents.withdrawnAt} is not null)`.mapWith(Number),
      })
      .from(dpdpConsents)
      .groupBy(dpdpConsents.purpose);
    return rows;
  });
}

/** Withdraws every live consent a person gave this fiduciary (erasure). */
export async function withdrawAllIn(tx: Tx, userId: string, universityId: string | null, now: Date) {
  return tx
    .update(dpdpConsents)
    .set({ withdrawnAt: now })
    .where(
      and(
        eq(dpdpConsents.userId, userId),
        universityId ? eq(dpdpConsents.universityId, universityId) : isNull(dpdpConsents.universityId),
        isNull(dpdpConsents.withdrawnAt),
      ),
    )
    .returning({ id: dpdpConsents.id });
}

/**
 * The id of an account made in the last few minutes with this email, so a sign-up form can
 * record its consents right after the account exists. Older accounts are never returned.
 */
export async function freshAccountId(email: string, now = new Date()): Promise<string | null> {
  const [u] = await zinny()
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email.trim()})`);
  return u && now.getTime() - u.createdAt.getTime() < 10 * 60_000 ? u.id : null;
}
