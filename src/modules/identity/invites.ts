/**
 * Invitations inside a university: the user.invited handler, and the admin page's list,
 * resend and revoke. Everything runs under row-level security for one university.
 *
 * Who may manage an invitation follows core's role rules: an Institute Admin manages
 * everyone's; a HOD manages those of faculty in their own department.
 */
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, roleAssignments, users, type RoleName } from "@/db/schema";
import type { DomainEvent } from "@/contracts/events";
import { assertCan, audit, can, reach, sendEmail, universityLite, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { AUTH, appUrl } from "@/server/auth/config";
import { sha256 } from "@/server/auth/tokens";
import { makeInviteToken } from "./auth";
import { inviteEmail } from "./emails";
import { FACULTY, roleTitle } from "./labels";
import { idnInvites } from "./schema";

const uni = (actor: Actor) => actor.universityId!;

/* ───────────────────────────── Sending ───────────────────────────── */

type Invitee = { id: string; name: string; email: string };

/**
 * Creates a new invitation link for a person and emails it. Any link they still had in
 * this university stops working ("replaced"). Call inside withTenant.
 */
async function issueInvite(
  tx: Tx,
  actor: Actor,
  person: Invitee,
  role: RoleName,
  opts: { eventId?: string | null; now?: Date } = {},
): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  const u = await universityLite(tx);
  await tx
    .update(idnInvites)
    .set({ revokedAt: now, revokeReason: "replaced" })
    .where(and(eq(idnInvites.userId, person.id), isNull(idnInvites.acceptedAt), isNull(idnInvites.revokedAt)));
  const token = makeInviteToken(u.id);
  const expiresAt = new Date(now.getTime() + AUTH.invite.validMs);
  const [row] = await tx
    .insert(idnInvites)
    .values({
      universityId: u.id,
      userId: person.id,
      role,
      tokenHash: sha256(token),
      eventId: opts.eventId ?? null,
      expiresAt,
      sentAt: now,
      invitedBy: actor.userId || null,
      createdAt: now,
    })
    .returning({ id: idnInvites.id });
  await audit(tx, actor, "invite.send", "idn_invite", row.id, { userId: person.id, role, resend: !opts.eventId });
  const mail = inviteEmail({
    name: person.name,
    institute: u.name,
    roleLabel: roleTitle(role),
    url: `${appUrl()}/invite/${token}`,
    expiresAt,
    timeZone: u.timezone,
  });
  // Sent last: if it fails, the transaction (and the new link) is rolled back and retried.
  await sendEmail({ to: person.email, ...mail, kind: "identity.invite", universityId: u.id });
  return { inviteId: row.id, token, expiresAt };
}

/**
 * user.invited → an invitation email. Idempotent per event (unique event_id). Skips
 * people who already have a password, since they can sign in already.
 */
export async function handleUserInvited(tx: Tx, actor: Actor, event: DomainEvent<"user.invited">, now = new Date()) {
  const [done] = await tx.select({ id: idnInvites.id }).from(idnInvites).where(eq(idnInvites.eventId, event.id));
  if (done) return;
  const [person] = await tx
    .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, event.payload.userId));
  if (!person || person.passwordHash) return;
  await issueInvite(tx, actor, person, event.payload.role, { eventId: event.id, now });
}

/* ───────────────────────────── Scope ───────────────────────────── */

/** Departments a person's faculty roles sit in (department scope, or the batch's department). */
async function facultyDepartments(tx: Tx, userIds: string[], now: Date): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (userIds.length === 0) return out;
  const rows = await tx
    .select({ userId: roleAssignments.userId, departmentId: roleAssignments.departmentId, batchDept: batches.departmentId })
    .from(roleAssignments)
    .leftJoin(batches, eq(batches.id, roleAssignments.batchId))
    .where(
      and(
        inArray(roleAssignments.userId, userIds),
        inArray(roleAssignments.role, [...FACULTY]),
        isNull(roleAssignments.revokedAt),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    );
  for (const r of rows) {
    const d = r.departmentId ?? r.batchDept;
    if (!d) continue;
    const set = out.get(r.userId) ?? new Set<string>();
    set.add(d);
    out.set(r.userId, set);
  }
  return out;
}

/**
 * Whether the actor may manage this person's invitation: an Institute Admin always;
 * a HOD when the invitation is for a faculty role in one of their departments.
 */
function canManage(actor: Actor, role: RoleName, departmentIds: Set<string> | undefined): boolean {
  const universityId = uni(actor);
  if (can(actor, "user.manage_roles", { universityId })) return true;
  if (!FACULTY.has(role) || !departmentIds?.size) return false;
  return can(actor, "user.manage_roles", { universityId, departmentIds: [...departmentIds] });
}

function assertManage(actor: Actor, role: RoleName, departmentIds: Set<string> | undefined) {
  if (!canManage(actor, role, departmentIds)) throw new ForbiddenError();
}

/** True when the actor can manage at least some invitations (the page is worth showing). */
export function canSeeInvites(actor: Actor): boolean {
  const r = reach(actor, "user.manage_roles", uni(actor));
  return r.all || r.departmentIds.size > 0;
}

/* ───────────────────────────── The admin page ───────────────────────────── */

export type InviteStatus = "pending" | "expired" | "not_sent";

export type InviteRow = {
  /** The invitation id, or null when the person was never sent one. */
  inviteId: string | null;
  userId: string;
  name: string;
  email: string;
  role: RoleName;
  roleLabel: string;
  status: InviteStatus;
  sentAt: Date | null;
  expiresAt: Date | null;
  /** How many invitations this person has been sent here. */
  sends: number;
};

export type AcceptedRow = { userId: string; name: string; email: string; roleLabel: string; acceptedAt: Date };

/**
 * People who were invited and haven't set a password yet (pending or expired), people
 * with a role here but no password and no invitation (not sent), and who joined recently.
 * Scoped: a HOD sees faculty of their own departments only.
 */
export async function listInvites(actor: Actor, opts: { now?: Date } = {}): Promise<{ open: InviteRow[]; accepted: AcceptedRow[] }> {
  const now = opts.now ?? new Date();
  if (!canSeeInvites(actor)) assertCan(actor, "user.manage_roles", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    // Everyone with an active role here and no password.
    const members = await tx
      .select({ userId: users.id, name: users.name, email: users.email, role: roleAssignments.role, startsAt: roleAssignments.startsAt })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(
        and(
          sql`${roleAssignments.universityId} = zinny_current_university()`,
          isNull(roleAssignments.revokedAt),
          isNull(users.passwordHash),
            or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
        ),
      )
      .orderBy(roleAssignments.startsAt);
    const ids = [...new Set(members.map((m) => m.userId))];
    const invites = ids.length
      ? await tx.select().from(idnInvites).where(inArray(idnInvites.userId, ids)).orderBy(desc(idnInvites.sentAt))
      : [];
    const depts = await facultyDepartments(tx, ids, now);

    const open: InviteRow[] = [];
    for (const userId of ids) {
      const m = members.filter((x) => x.userId === userId);
      const mine = invites.filter((i) => i.userId === userId);
      // A revoked invitation has no live link, so the person is listed as "not sent".
      const live = mine.find((i) => !i.acceptedAt && !i.revokedAt);
      const role = live?.role ?? m[m.length - 1].role;
      if (!canManage(actor, role, depts.get(userId))) continue;
      open.push({
        inviteId: live?.id ?? null,
        userId,
        name: m[0].name,
        email: m[0].email,
        role,
        roleLabel: roleTitle(role),
        status: !live ? "not_sent" : live.expiresAt <= now ? "expired" : "pending",
        sentAt: live?.sentAt ?? null,
        expiresAt: live?.expiresAt ?? null,
        sends: mine.length,
      });
    }
    const rank: Record<InviteStatus, number> = { expired: 0, not_sent: 1, pending: 2 };
    open.sort((a, b) => rank[a.status] - rank[b.status] || (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0) || a.name.localeCompare(b.name));

    const joined = await tx
      .select({ userId: idnInvites.userId, role: idnInvites.role, acceptedAt: idnInvites.acceptedAt, name: users.name, email: users.email })
      .from(idnInvites)
      .innerJoin(users, eq(users.id, idnInvites.userId))
      .where(and(sql`${idnInvites.acceptedAt} is not null`, gt(idnInvites.acceptedAt, new Date(now.getTime() - 30 * 86_400_000))))
      .orderBy(desc(idnInvites.acceptedAt))
      .limit(50);
    const joinedDepts = await facultyDepartments(tx, [...new Set(joined.map((j) => j.userId))], now);
    const accepted = joined
      .filter((j) => canManage(actor, j.role, joinedDepts.get(j.userId)))
      .map((j) => ({ userId: j.userId, name: j.name, email: j.email, roleLabel: roleTitle(j.role), acceptedAt: j.acceptedAt! }));
    return { open, accepted };
  });
}

/** The person's active role here to put in a new invitation (the most recent one). */
async function currentRole(tx: Tx, userId: string, now: Date): Promise<RoleName | null> {
  const [r] = await tx
    .select({ role: roleAssignments.role })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        sql`${roleAssignments.universityId} = zinny_current_university()`,
        isNull(roleAssignments.revokedAt),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    )
    .orderBy(desc(roleAssignments.startsAt))
    .limit(1);
  return r?.role ?? null;
}

/**
 * Sends a fresh invitation (a new link, valid 7 days; any older link stops working).
 * Works for pending, expired, revoked and never-sent invitations. Not more than once a
 * minute per person, so a double click doesn't send two emails.
 */
export async function resendInvite(actor: Actor, userId: string, opts: { now?: Date } = {}): Promise<{ email: string; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const [person] = await tx
      .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    const [live] = await tx
      .select()
      .from(idnInvites)
      .where(and(eq(idnInvites.userId, userId), isNull(idnInvites.acceptedAt), isNull(idnInvites.revokedAt)))
      .orderBy(desc(idnInvites.sentAt))
      .limit(1);
    const role = live?.role ?? (person ? await currentRole(tx, userId, now) : null);
    if (!person || !role) throw new NotFoundError("Person");
    assertManage(actor, role, (await facultyDepartments(tx, [userId], now)).get(userId));
    if (person.passwordHash) throw new ConflictError(`${person.name} has already set a password and can sign in.`, "has_password");
    if (live && now.getTime() - live.sentAt.getTime() < AUTH.invite.resendGapMs) {
      throw new ValidationError(`An invitation was sent to ${person.name} a moment ago. Wait a minute before sending another.`, "too_soon");
    }
    const { expiresAt } = await issueInvite(tx, actor, person, role, { now });
    return { email: person.email, expiresAt };
  });
}

/**
 * Cancels a pending invitation: its link stops working at once. The person keeps their
 * role here (remove it under Users to take away access); they can be invited again.
 */
export async function revokeInvite(actor: Actor, inviteId: string, opts: { now?: Date } = {}): Promise<{ name: string }> {
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .select({ invite: idnInvites, name: users.name })
      .from(idnInvites)
      .innerJoin(users, eq(users.id, idnInvites.userId))
      .where(eq(idnInvites.id, inviteId))
      .for("update", { of: idnInvites });
    if (!row) throw new NotFoundError("Invitation");
    assertManage(actor, row.invite.role, (await facultyDepartments(tx, [row.invite.userId], now)).get(row.invite.userId));
    if (row.invite.acceptedAt) throw new ConflictError(`${row.name} has already joined, so there's nothing to revoke.`, "accepted");
    if (row.invite.revokedAt) throw new ConflictError("This invitation was already revoked or replaced.", "revoked");
    await tx.update(idnInvites).set({ revokedAt: now, revokeReason: "revoked" }).where(eq(idnInvites.id, inviteId));
    await audit(tx, actor, "invite.revoke", "idn_invite", inviteId, { userId: row.invite.userId });
    return { name: row.name };
  });
}

/** Number of invitations waiting (pending or expired) that this actor manages. */
export async function openInviteCount(actor: Actor): Promise<number> {
  if (!canSeeInvites(actor)) return 0;
  const { open } = await listInvites(actor);
  return open.filter((r) => r.status !== "not_sent").length;
}
