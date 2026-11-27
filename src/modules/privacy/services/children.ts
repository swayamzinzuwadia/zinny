/**
 * Children (Act s.9, Rule 10). A learner under 18 (by date of birth, or because they said so)
 * needs a parent or guardian's verifiable consent. We send the guardian a link by email or
 * SMS; they open it, read what we process and confirm. Until then the learner is "blocked":
 * no optional purposes (news, analytics), no tracking or behavioural monitoring.
 *
 * Zinny holds no date of birth anywhere else, so it is asked for at student sign-up (an age
 * declaration with an optional date) and can be given later on the privacy page.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { sendEmail, sendSms, type Actor } from "@/server/core";
import { ValidationError, NotFoundError, ConflictError } from "@/server/errors";
import { dpdpConsents, dpdpGuardianConsents } from "../schema";
import { GUARDIAN_LINK_DAYS, NOTICE_VERSION, isMinor } from "../lib/rules";
import { ipHash, newToken, tokenHash } from "../lib/hash";
import { selfOf, todayOf } from "./access";
import { zinny, zinnyAudit, zinnyTx } from "./system";

export type MinorState = { minor: false } | { minor: true; verified: boolean; guardianName: string; contact: string; sentAt: Date; expiresAt: Date };

/**
 * Whether this person is a minor and whether a guardian has confirmed. Age is a fact about the
 * person, not about one institute, so every declaration counts wherever it was made.
 */
export async function minorState(userId: string): Promise<MinorState> {
  const rows = await zinny().select().from(dpdpGuardianConsents).where(eq(dpdpGuardianConsents.userId, userId)).orderBy(desc(dpdpGuardianConsents.createdAt));
  if (rows.length === 0) return { minor: false };
  const verified = rows.find((r) => r.status === "verified");
  const r = verified ?? rows[0];
  return { minor: true, verified: !!verified, guardianName: r.guardianName, contact: maskContact(r.guardianEmail ?? r.guardianPhone ?? ""), sentAt: r.sentAt, expiresAt: r.expiresAt };
}

/**
 * Tracking, behavioural monitoring and optional purposes are allowed for adults, and for
 * minors only once a guardian has confirmed (s.9(1) and 9(3)). Other modules should check
 * this before awarding behaviour-based features (see the handoff's requests).
 */
export async function trackingAllowed(userId: string): Promise<boolean> {
  const s = await minorState(userId);
  return !s.minor || s.verified;
}

export async function myMinorState(actor: Actor): Promise<MinorState> {
  return minorState(selfOf(actor).userId);
}

function maskContact(c: string): string {
  if (c.includes("@")) {
    const [name, domain] = c.split("@");
    return `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
  }
  return c.length > 4 ? `${"•".repeat(c.length - 4)}${c.slice(-4)}` : c;
}

export type AgeInput = {
  /** "adult", "minor" or "" (not answered). */
  age: string;
  birthDate?: string;
  guardianName?: string;
  guardianContact?: string;
};

export type GuardianDetails = { birthDate: string | null; guardianName: string; guardianEmail: string | null; guardianPhone: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks an age declaration. Returns null for an adult, or the guardian's details for a minor.
 * A date of birth that makes the learner under 18 wins over a ticked "18 or older".
 */
export function checkAgeInput(input: AgeInput, today: string): GuardianDetails | null {
  const birthDate = (input.birthDate ?? "").trim() || null;
  if (birthDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate)) || birthDate > today) {
      throw new ValidationError("Enter your date of birth as a real date in the past, or leave it empty.");
    }
    if (birthDate < "1900-01-01") throw new ValidationError("Check your date of birth: the year looks wrong.");
  }
  const minor = (birthDate && isMinor(birthDate, today)) || input.age === "minor";
  if (!minor) {
    if (input.age !== "adult" && !birthDate) throw new ValidationError("Tell us whether you are 18 or older. Learners under 18 need a parent or guardian's consent.");
    return null;
  }
  const guardianName = (input.guardianName ?? "").trim();
  if (guardianName.length < 2) throw new ValidationError("Enter your parent or guardian's full name. Learners under 18 need their consent.");
  const contact = (input.guardianContact ?? "").trim();
  if (EMAIL_RE.test(contact)) return { birthDate, guardianName, guardianEmail: contact.toLowerCase(), guardianPhone: null };
  const digits = contact.replace(/[\s()-]/g, "");
  if (/^\+?\d{10,13}$/.test(digits)) {
    const phone = digits.startsWith("+") ? digits : digits.length === 10 ? `+91${digits}` : `+${digits}`;
    return { birthDate, guardianName, guardianEmail: null, guardianPhone: phone };
  }
  throw new ValidationError("Enter your parent or guardian's email address or 10-digit mobile number, so we can ask for their consent.");
}

async function sendGuardianLink(d: { guardianName: string; guardianEmail: string | null; guardianPhone: string | null; learnerName: string; link: string; universityId: string | null }) {
  const text =
    `Hello ${d.guardianName}, ${d.learnerName} has signed up on Zinny and says they are under 18. ` +
    `Indian law needs your consent before we process their data. Read what we keep and confirm here: ${d.link} ` +
    `The link works for ${GUARDIAN_LINK_DAYS} days. If you don't know ${d.learnerName}, ignore this message.`;
  if (d.guardianEmail) {
    await sendEmail({
      to: d.guardianEmail,
      subject: `Your consent for ${d.learnerName} on Zinny`,
      text,
      html: `<p>Hello ${esc(d.guardianName)},</p><p>${esc(d.learnerName)} has signed up on Zinny and says they are under 18. Indian law needs your consent before we process their data.</p><p><a href="${esc(d.link)}">Read what we keep and give your consent</a></p><p>The link works for ${GUARDIAN_LINK_DAYS} days. If you don't know ${esc(d.learnerName)}, ignore this email.</p>`,
      kind: "privacy.guardian",
    });
  } else if (d.guardianPhone) {
    await sendSms({ to: d.guardianPhone, text, kind: "privacy.guardian" });
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Records that the learner is a minor and sends their guardian a consent link. Used at
 * sign-up (with a fresh account's own actor) and from the privacy page. Returns the masked
 * contact the link went to, and the token for tests and seeds: callers must never show the
 * token to the learner, or they could confirm for their guardian.
 */
export async function startGuardianConsent(
  actor: Actor,
  details: GuardianDetails,
  opts: { ip: string | null; linkBase: string; now?: Date },
): Promise<{ sentTo: string; token: string }> {
  const me = selfOf(actor);
  const now = opts.now ?? new Date();
  const state = await minorState(me.userId);
  if (state.minor && state.verified) throw new ConflictError("Your parent or guardian has already given their consent.");
  const { token, hash } = newToken();
  await zinnyTx(async (tx) => {
    // A new request replaces any earlier link that wasn't used.
    await tx
      .update(dpdpGuardianConsents)
      .set({ status: "refused" })
      .where(and(eq(dpdpGuardianConsents.userId, me.userId), eq(dpdpGuardianConsents.status, "pending")));
    const [row] = await tx
      .insert(dpdpGuardianConsents)
      .values({
        universityId: me.universityId,
        userId: me.userId,
        ...details,
        tokenHash: hash,
        sentAt: now,
        expiresAt: new Date(now.getTime() + GUARDIAN_LINK_DAYS * 86_400_000),
        ipHash: ipHash(opts.ip),
      })
      .returning({ id: dpdpGuardianConsents.id });
    await zinnyAudit(tx, actor, me.universityId, "privacy.guardian.request", "dpdp_guardian_consents", row.id, {
      channel: details.guardianEmail ? "email" : "sms",
      birthDateGiven: !!details.birthDate,
    });
  });
  await sendGuardianLink({ ...details, learnerName: actor.name, link: `${opts.linkBase.replace(/\/$/, "")}/privacy/guardian/${token}`, universityId: me.universityId });
  return { sentTo: maskContact(details.guardianEmail ?? details.guardianPhone ?? ""), token };
}

/** Sends the guardian a fresh link to the same contact. */
export async function resendGuardianLink(actor: Actor, opts: { ip: string | null; linkBase: string }): Promise<string> {
  const me = selfOf(actor);
  const [last] = await zinny()
    .select()
    .from(dpdpGuardianConsents)
    .where(eq(dpdpGuardianConsents.userId, me.userId))
    .orderBy(desc(dpdpGuardianConsents.createdAt))
    .limit(1);
  if (!last) throw new NotFoundError("Guardian request");
  const r = await startGuardianConsent(actor, { birthDate: last.birthDate, guardianName: last.guardianName, guardianEmail: last.guardianEmail, guardianPhone: last.guardianPhone }, opts);
  return r.sentTo;
}

export type GuardianLink =
  | { state: "invalid" }
  | { state: "expired" | "pending" | "verified"; learnerName: string; guardianName: string };

/** What the guardian's link page shows. Anyone with the link may read this much, nothing more. */
export async function guardianLink(token: string, now = new Date()): Promise<GuardianLink> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { state: "invalid" };
  const [row] = await zinny().select().from(dpdpGuardianConsents).where(eq(dpdpGuardianConsents.tokenHash, tokenHash(token)));
  if (!row || row.status === "refused") return { state: "invalid" };
  const [learner] = await zinny().execute<{ name: string }>(
    // Only the learner's first name goes to the guardian's page.
    sql`select split_part(name, ' ', 1) as name from users where id = ${row.userId}`,
  );
  const base = { learnerName: learner?.name ?? "Your child", guardianName: row.guardianName };
  if (row.status === "verified") return { state: "verified", ...base };
  if (row.expiresAt < now) return { state: "expired", ...base };
  return { state: "pending", ...base };
}

/**
 * The guardian confirms. Holding the link sent to their own email or phone is the
 * verification (Rule 10(1)(b): details the guardian provides, checked through a channel they
 * control). Records the guardian consent for the learner.
 */
export async function confirmGuardianConsent(token: string, opts: { ip: string | null; agree: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  if (!opts.agree) throw new ValidationError("Tick the box to confirm you are the learner's parent or legal guardian and give your consent.");
  const link = await guardianLink(token, now);
  if (link.state === "invalid") throw new NotFoundError("Consent link");
  if (link.state === "expired") throw new ValidationError("This link has expired. Ask the learner to send a new one from their privacy page.");
  if (link.state === "verified") return;
  await zinnyTx(async (tx) => {
    const [row] = await tx
      .update(dpdpGuardianConsents)
      .set({ status: "verified", verifiedAt: now, ipHash: ipHash(opts.ip) })
      .where(and(eq(dpdpGuardianConsents.tokenHash, tokenHash(token)), eq(dpdpGuardianConsents.status, "pending")))
      .returning();
    if (!row) return;
    await tx
      .insert(dpdpConsents)
      .values({ universityId: row.universityId, userId: row.userId, purpose: "guardian", noticeVersion: NOTICE_VERSION, grantedAt: now, source: "guardian", ipHash: ipHash(opts.ip) })
      .onConflictDoNothing();
    const guardian: Actor = { userId: "", name: row.guardianName, email: row.guardianEmail ?? "", universityId: row.universityId, assignments: [], supportSessionId: null };
    await zinnyAudit(tx, guardian, row.universityId, "privacy.guardian.verify", "dpdp_guardian_consents", row.id, { learnerUserId: row.userId });
  });
}

/** For the privacy page: declare an age (or a date of birth) after sign-up. */
export async function declareAge(actor: Actor, input: AgeInput, opts: { ip: string | null; linkBase: string }): Promise<string | null> {
  selfOf(actor);
  const details = checkAgeInput(input, await todayOf(null));
  if (!details) return null;
  return (await startGuardianConsent(actor, details, opts)).sentTo;
}
