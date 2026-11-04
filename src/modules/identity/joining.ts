import "server-only";
/**
 * Joining an institute with its joining code.
 *
 * Every institute has a short code (made the first time someone needs it). A learner types
 * it when signing up, or later from /join. The institute chooses what happens next:
 *  - "instant": the learner becomes a student straight away;
 *  - "approval" (the default): a join request waits until an Institute Admin, or the HOD of
 *    the department the learner picked, accepts it and chooses the student's departments.
 * Inside the institute a student only sees the courses of their departments (core students.ts).
 *
 * Brief exception (as for sign-up in auth.ts): the learner has no role in the institute yet,
 * so their side runs on the system connection; the admin side runs under row-level security.
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { systemDb, type Tx } from "@/db/client";
import { departments, roleAssignments, universities, users } from "@/db/schema";
import {
  addStudentDepartmentsTx,
  admitStudentTx,
  assertCan,
  audit,
  ensureStudentRoleTx,
  hodsOf,
  notify,
  reach,
  sendEmail,
  withTenant,
  type Actor,
} from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { personActor } from "@/server/auth/audit";
import { appUrl } from "@/server/auth/config";
import { mktLearners } from "@/modules/marketplace/schema";
import { joinDecisionEmail } from "./emails";
import { landingFor } from "./labels";
import { idnJoinRequests, idnSettings } from "./schema";

export type JoinMode = "approval" | "instant";

/* ───────────────────────────── Codes ───────────────────────────── */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups
const CODE_LENGTH = 6;

function newCode() {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** "brt-4k9q " → "BRT4K9Q": what people type is forgiving about case, spaces and dashes. */
export function normaliseCode(raw: string | null | undefined) {
  return (raw ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/** The institute a joining code belongs to, with its departments for the student to pick from. */
export async function findInstituteByCode(raw: string | null | undefined) {
  const code = normaliseCode(raw);
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const [row] = await systemDb()
    .select({ id: universities.id, slug: universities.slug, name: universities.name, status: universities.status, joinMode: idnSettings.joinMode })
    .from(idnSettings)
    .innerJoin(universities, eq(universities.id, idnSettings.universityId))
    .where(eq(idnSettings.joinCode, code));
  if (!row || row.status !== "active") return null;
  const depts = await systemDb()
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.universityId, row.id))
    .orderBy(departments.name);
  return { id: row.id, slug: row.slug, name: row.name, code, joinMode: row.joinMode as JoinMode, departments: depts };
}

export type JoinTarget = NonNullable<Awaited<ReturnType<typeof findInstituteByCode>>>;

/* ───────────────────────────── Learner side ───────────────────────────── */

export type JoinResult = { status: "joined"; landing: string; institute: string } | { status: "requested"; institute: string; requestId: string };

/** People who are told about a new request: every Institute Admin, and the picked department's HODs. */
async function admitters(tx: Tx, universityId: string, departmentId: string | null) {
  const admins = await tx
    .select({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.universityId, universityId), eq(roleAssignments.role, "institute_admin"), isNull(roleAssignments.revokedAt)));
  const hods = departmentId ? await hodsOf(tx, departmentId) : [];
  return [...new Set([...admins.map((a) => a.userId), ...hods])];
}

/**
 * Joins (or asks to join) the institute inside an open system transaction. Used by sign-up
 * with a code and by /join. The person must already exist.
 */
export async function joinTx(
  tx: Tx,
  target: JoinTarget,
  person: { id: string; name: string; email: string },
  opts: { departmentId?: string | null; message?: string | null } = {},
): Promise<JoinResult> {
  const departmentId = opts.departmentId && target.departments.some((d) => d.id === opts.departmentId) ? opts.departmentId : null;
  const me = personActor(target.id, person.id);

  const [already] = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, person.id),
        eq(roleAssignments.universityId, target.id),
        inArray(roleAssignments.role, ["student", "alumni"]),
        isNull(roleAssignments.revokedAt),
      ),
    );
  if (already) return { status: "joined", landing: landingFor(target.slug, "student"), institute: target.name };

  if (target.joinMode === "instant") {
    await ensureStudentRoleTx(tx, me, person.id);
    if (departmentId) await addStudentDepartmentsTx(tx, me, person.id, [departmentId]);
    await audit(tx, me, "user.join_code", "user", person.id, { mode: "instant", departmentId });
    return { status: "joined", landing: landingFor(target.slug, "student"), institute: target.name };
  }

  const [pending] = await tx
    .select({ id: idnJoinRequests.id })
    .from(idnJoinRequests)
    .where(and(eq(idnJoinRequests.universityId, target.id), eq(idnJoinRequests.userId, person.id), eq(idnJoinRequests.status, "pending")));
  if (pending) return { status: "requested", institute: target.name, requestId: pending.id };

  const [req] = await tx
    .insert(idnJoinRequests)
    .values({
      universityId: target.id,
      userId: person.id,
      name: person.name,
      email: person.email,
      departmentId,
      message: opts.message?.trim().slice(0, 300) || null,
    })
    .returning({ id: idnJoinRequests.id });
  await notify(tx, target.id, await admitters(tx, target.id, departmentId), {
    kind: "join.requested",
    title: `${person.name} asked to join`,
    body: departmentId ? `For ${target.departments.find((d) => d.id === departmentId)?.name}. Accept or decline it under Users.` : "Accept or decline it under Users.",
    data: { requestId: req.id },
  });
  await audit(tx, me, "user.join_request", "idn_join_request", req.id, { departmentId });
  return { status: "requested", institute: target.name, requestId: req.id };
}

/** A signed-in learner joins (or asks to join) with a code, from /join. */
export async function joinWithCode(userId: string, input: { code: string; departmentId?: string | null; message?: string | null }) {
  const target = await findInstituteByCode(input.code);
  if (!target) throw new ValidationError("We can't find an institute with that code. Check it with your institute and try again.", "unknown_code");
  return systemDb().transaction(async (tx) => {
    const [person] = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    if (!person) throw new NotFoundError("Account");
    // Until they're in, the marketplace is theirs to use.
    await tx.insert(mktLearners).values({ userId }).onConflictDoNothing();
    return joinTx(tx, target, person, input);
  });
}

/** The learner's requests, newest first, for /join. */
export async function myJoinRequests(userId: string) {
  return systemDb()
    .select({
      id: idnJoinRequests.id,
      status: idnJoinRequests.status,
      createdAt: idnJoinRequests.createdAt,
      decidedAt: idnJoinRequests.decidedAt,
      decisionNote: idnJoinRequests.decisionNote,
      institute: universities.name,
      slug: universities.slug,
    })
    .from(idnJoinRequests)
    .innerJoin(universities, eq(universities.id, idnJoinRequests.universityId))
    .where(eq(idnJoinRequests.userId, userId))
    .orderBy(desc(idnJoinRequests.createdAt))
    .limit(20);
}

/** The learner withdraws their own pending request. */
export async function cancelJoinRequest(userId: string, requestId: string) {
  return systemDb().transaction(async (tx) => {
    const [req] = await tx.select().from(idnJoinRequests).where(eq(idnJoinRequests.id, requestId)).for("update");
    if (!req || req.userId !== userId) throw new NotFoundError("Request");
    if (req.status !== "pending") return;
    await tx.update(idnJoinRequests).set({ status: "cancelled", decidedAt: new Date() }).where(eq(idnJoinRequests.id, requestId));
    await audit(tx, personActor(req.universityId, userId), "user.join_request_cancel", "idn_join_request", requestId);
  });
}

/* ───────────────────────────── Institute side ───────────────────────────── */

const uni = (actor: Actor) => actor.universityId!;

/** Who may admit students: everyone (admins) or only some departments (HODs). */
function admitReach(actor: Actor) {
  return reach(actor, "user.admit", uni(actor));
}

export function canAdmit(actor: Actor) {
  const r = admitReach(actor);
  return r.all || r.departmentIds.size > 0;
}

export type JoinRequestRow = typeof idnJoinRequests.$inferSelect;

/**
 * Join requests this person may answer. Admins see every one; a HOD sees those for their
 * own department (requests with no department go to admins).
 */
export async function listJoinRequests(actor: Actor, which: "pending" | "decided" = "pending"): Promise<JoinRequestRow[]> {
  const r = admitReach(actor);
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(idnJoinRequests)
      .where(which === "pending" ? eq(idnJoinRequests.status, "pending") : inArray(idnJoinRequests.status, ["approved", "rejected"]))
      .orderBy(which === "pending" ? idnJoinRequests.createdAt : desc(idnJoinRequests.decidedAt))
      .limit(which === "pending" ? 500 : 50);
    return rows.filter((q) => r.all || (q.departmentId !== null && r.departmentIds.has(q.departmentId)));
  });
}

/**
 * Accept (with the student's departments, at least one) or decline a join request.
 * A HOD can only accept into, or decline for, their own department.
 */
export async function decideJoinRequest(actor: Actor, requestId: string, input: { accept: boolean; departmentIds: string[]; note?: string }) {
  const result = await withTenant(actor, async (tx) => {
    const [req] = await tx.select().from(idnJoinRequests).where(eq(idnJoinRequests.id, requestId)).for("update");
    if (!req) throw new NotFoundError("Request");
    if (req.status !== "pending") throw new ConflictError("This request has already been answered.", "already_decided");
    const [university] = await tx.select({ name: universities.name, slug: universities.slug }).from(universities).where(eq(universities.id, uni(actor)));
    const note = input.note?.trim().slice(0, 300) || null;

    if (input.accept) {
      await admitStudentTx(tx, actor, req.userId, input.departmentIds);
    } else {
      assertCan(actor, "user.admit", { universityId: uni(actor), departmentIds: req.departmentId ? [req.departmentId] : [] });
    }
    await tx
      .update(idnJoinRequests)
      .set({ status: input.accept ? "approved" : "rejected", decidedBy: actor.userId || null, decidedAt: new Date(), decisionNote: note })
      .where(eq(idnJoinRequests.id, requestId));
    if (input.accept) {
      await notify(tx, uni(actor), [req.userId], {
        kind: "join.approved",
        title: `You've joined ${university.name}`,
        body: "Your request was accepted. Courses shows what you can join now.",
        data: { requestId },
      });
    }
    await audit(tx, actor, input.accept ? "user.join_accept" : "user.join_decline", "idn_join_request", requestId, {
      userId: req.userId,
      departmentIds: input.accept ? input.departmentIds : undefined,
      note,
    });
    return { req, university, note };
  });

  // A declined person has no role here, so the notification job can't reach them: email directly.
  const { req, university, note } = result;
  if (!input.accept) {
    const mail = joinDecisionEmail({ name: req.name, institute: university.name, accepted: false, note, url: `${appUrl()}/join` });
    await sendEmail({ to: req.email, ...mail, kind: "identity.join_declined", universityId: uni(actor) }).catch(() => undefined);
  }
  return { status: input.accept ? ("approved" as const) : ("rejected" as const) };
}

/* ───────────────────────────── Settings ───────────────────────────── */

export type JoinSettings = { code: string; mode: JoinMode };

/** The institute's code and mode, making the code the first time it's asked for. Admins and HODs share it. */
export async function getJoinSettings(actor: Actor): Promise<JoinSettings> {
  if (!canAdmit(actor)) assertCan(actor, "settings.manage", { universityId: uni(actor) });
  const code = await freshCode();
  return withTenant(actor, async (tx) => {
    const [s] = await tx.select().from(idnSettings).where(eq(idnSettings.universityId, uni(actor)));
    if (s?.joinCode) return { code: s.joinCode, mode: s.joinMode as JoinMode };
    await tx
      .insert(idnSettings)
      .values({ universityId: uni(actor), joinCode: code })
      .onConflictDoUpdate({ target: idnSettings.universityId, set: { joinCode: code } });
    return { code, mode: (s?.joinMode as JoinMode) ?? "approval" };
  });
}

/** A code no institute uses yet. The code index spans every institute, which row-level security hides. */
async function freshCode() {
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    const [taken] = await systemDb().select({ u: idnSettings.universityId }).from(idnSettings).where(eq(idnSettings.joinCode, code));
    if (!taken) return code;
  }
  throw new ConflictError("Couldn't make a new code. Try again.");
}

/** Institute Admins only (`settings.manage`): instant joining or approval for every join. */
export async function setJoinMode(actor: Actor, mode: JoinMode) {
  assertCan(actor, "settings.manage", { universityId: uni(actor) });
  if (mode !== "approval" && mode !== "instant") throw new ValidationError("Pick how students join.");
  return withTenant(actor, async (tx) => {
    const now = new Date();
    await tx
      .insert(idnSettings)
      .values({ universityId: uni(actor), joinMode: mode, updatedAt: now, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: idnSettings.universityId, set: { joinMode: mode, updatedAt: now, updatedBy: actor.userId || null } });
    await audit(tx, actor, `settings.join_mode_${mode}`, "idn_settings", uni(actor));
    return { mode };
  });
}

/** Institute Admins only: a new code; the old one stops working at once. */
export async function regenerateJoinCode(actor: Actor) {
  assertCan(actor, "settings.manage", { universityId: uni(actor) });
  const code = await freshCode();
  return withTenant(actor, async (tx) => {
    const now = new Date();
    await tx
      .insert(idnSettings)
      .values({ universityId: uni(actor), joinCode: code, updatedAt: now, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: idnSettings.universityId, set: { joinCode: code, updatedAt: now, updatedBy: actor.userId || null } });
    await audit(tx, actor, "settings.join_code_new", "idn_settings", uni(actor));
    return { code };
  });
}
