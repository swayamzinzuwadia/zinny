/**
 * Core API functions added for the module wave (contracts.md section 8): course
 * completion, the money hooks payments needs, and university / team management for
 * the Zinny team panel. Each checks permission where a person is acting.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { auditLog, batches, courses, enrolments, orders, roleAssignments, universities, users, type RoleName } from "@/db/schema";
import type { CheckoutOrder } from "@/contracts/core";
import { assertCan, assertPlatform, canPlatform, isActive, type Actor } from "../authz/engine";
import { ACTIONS, PLATFORM_ROLES, type Action } from "../authz/roles";
import { liveCustomRole } from "./roles";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { emit, emitFor } from "../events";
import { audit, withTenant } from "../tenant";
import { addDays, todayIn } from "../lib/dates";

function uni(actor: Actor) {
  if (!actor.universityId) throw new ForbiddenError("No institute selected.");
  return actor.universityId;
}

/* ─────────────────────────── Course completion ─────────────────────────── */

export type CompletionResult = { status: "completed" | "already_completed"; enrolmentId: string };

/**
 * Marks an active enrolment completed and emits `enrolment.completed`, in one transaction.
 * Idempotent: on a completed enrolment it does nothing and emits nothing, even when two
 * calls race (the enrolment row is locked). Needs `enrolment.complete` on the batch:
 * Admin and HOD, or the university's system actor for automatic completion
 * (content-progress calls it with `systemActorFor(universityId)` when a learner reaches 100%).
 */
export async function markEnrolmentCompleted(actor: Actor, enrolmentId: string): Promise<CompletionResult> {
  return withTenant(actor, async (tx) => {
    const [e] = await tx.select().from(enrolments).where(eq(enrolments.id, enrolmentId)).for("update");
    if (!e) throw new NotFoundError("Enrolment");
    const [b] = await tx.select({ departmentId: batches.departmentId }).from(batches).where(eq(batches.id, e.batchId));
    assertCan(actor, "enrolment.complete", { universityId: e.universityId, departmentIds: b ? [b.departmentId] : [], batchIds: [e.batchId] });
    if (e.status === "completed") return { status: "already_completed", enrolmentId };
    if (e.status !== "active") throw new ConflictError("Only an active enrolment can be marked complete.", "not_active");
    await tx.update(enrolments).set({ status: "completed" }).where(eq(enrolments.id, enrolmentId));
    await audit(tx, actor, "enrolment.complete", "enrolment", enrolmentId, { courseId: e.courseId, batchId: e.batchId });
    await emit(tx, actor, "enrolment.completed", { enrolmentId, userId: e.userId, courseId: e.courseId, batchId: e.batchId });
    return { status: "completed", enrolmentId };
  });
}

/* ─────────────────────────── Money ─────────────────────────── */

/** The student's own order, with its course, batch and seat hold. Anyone else gets "not found". */
export async function orderForCheckout(actor: Actor, orderId: string): Promise<CheckoutOrder> {
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .select({
        order: orders,
        course: { id: courses.id, title: courses.title, gstRateBp: courses.gstRateBp },
        batch: { id: batches.id, name: batches.name, recorded: batches.recorded },
      })
      .from(orders)
      .innerJoin(courses, eq(courses.id, orders.courseId))
      .innerJoin(batches, eq(batches.id, orders.batchId))
      .where(eq(orders.id, orderId));
    if (!row || row.order.userId !== actor.userId) throw new NotFoundError("Order");
    assertCan(actor, "self.enrol", { universityId: uni(actor), ownerUserId: row.order.userId });
    const [e] = row.order.enrolmentId
      ? await tx
          .select({ id: enrolments.id, status: enrolments.status, holdExpiresAt: enrolments.holdExpiresAt })
          .from(enrolments)
          .where(eq(enrolments.id, row.order.enrolmentId))
      : [];
    const o = row.order;
    return {
      order: {
        id: o.id,
        status: o.status,
        basePaise: o.basePaise,
        gstPaise: o.gstPaise,
        totalPaise: o.totalPaise,
        gateway: o.gateway,
        gatewayOrderId: o.gatewayOrderId,
        gatewayPaymentId: o.gatewayPaymentId,
        paidAt: o.paidAt,
        userId: o.userId,
        universityId: o.universityId,
      },
      course: row.course,
      batch: row.batch,
      enrolment: e ?? null,
    };
  });
}

export type RefundMark = { status: "refunded" | "already_refunded"; orderId: string };

/**
 * Records that an order's money went back to the student (call it after the gateway
 * confirms the refund). Only paid and refund_due orders can be refunded. Idempotent.
 * It changes only the order: a refunded student keeps any active enrolment unless an
 * admin removes it. Partial refunds are tracked by payments in its own tables.
 * Needs `finance.refund`.
 */
export async function markOrderRefunded(actor: Actor, orderId: string, gatewayRefundId: string): Promise<RefundMark> {
  assertCan(actor, "finance.refund", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) throw new NotFoundError("Order");
    if (o.status === "refunded") return { status: "already_refunded", orderId };
    if (o.status !== "paid" && o.status !== "refund_due") throw new ConflictError("Only paid orders can be refunded.", "not_paid");
    await tx.update(orders).set({ status: "refunded" }).where(eq(orders.id, orderId));
    await audit(tx, actor, "order.refunded", "order", orderId, { gatewayRefundId, previousStatus: o.status, totalPaise: o.totalPaise });
    return { status: "refunded", orderId };
  });
}

/** Which university a gateway order belongs to. For webhooks, which arrive without a tenant. */
export async function orderUniversity(gatewayOrderId: string): Promise<string | null> {
  if (!gatewayOrderId) return null;
  const [o] = await systemDb()
    .select({ universityId: orders.universityId })
    .from(orders)
    .where(eq(orders.gatewayOrderId, gatewayOrderId))
    .limit(1);
  return o?.universityId ?? null;
}

/* ─────────────────────────── Zinny team ─────────────────────────── */

export type UniversityPatch = {
  name?: string;
  slug?: string;
  timezone?: string;
  gstin?: string | null;
  legalName?: string | null;
  address?: string | null;
  stateCode?: string;
  invoicePrefix?: string;
  branding?: { primaryColor?: string; logoUrl?: string };
  /** "active", "suspended" or "frozen" (a self sign-up whose free trial ended without a plan). */
  status?: UniversityStatus;
  /** A self sign-up's last day of free trial, "YYYY-MM-DD"; null for none. */
  trialEndsAt?: string | null;
};

/** "frozen": a self sign-up's trial ended without a paid plan. Nothing is deleted; admins can only choose a plan. */
export type UniversityStatus = "active" | "suspended" | "frozen";
const STATUSES: readonly UniversityStatus[] = ["active", "suspended", "frozen"];
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Edits a university's basics. Needs `platform.manage_universities`. Logged in the university's audit log. */
export async function updateUniversity(actor: Actor, universityId: string, patch: UniversityPatch) {
  assertPlatform(actor, "platform.manage_universities");
  const set: Partial<typeof universities.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (patch.name.trim().length < 2) throw new ValidationError("Give the institute a name.");
    set.name = patch.name.trim();
  }
  if (patch.slug !== undefined) {
    const slug = patch.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new ValidationError("Slug can use a–z, 0–9 and hyphens.");
    set.slug = slug;
  }
  if (patch.timezone !== undefined) {
    if (!validTimezone(patch.timezone)) throw new ValidationError("Pick a valid time zone, like Asia/Kolkata.");
    set.timezone = patch.timezone;
  }
  if (patch.gstin !== undefined) {
    const g = patch.gstin?.trim().toUpperCase() || null;
    if (g && !/^[0-9]{2}[A-Z0-9]{13}$/.test(g)) throw new ValidationError("A GSTIN has 15 characters and starts with the 2-digit state code.");
    set.gstin = g;
  }
  if (patch.legalName !== undefined) set.legalName = patch.legalName?.trim() || null;
  if (patch.address !== undefined) set.address = patch.address?.trim() || null;
  if (patch.stateCode !== undefined) {
    if (!/^[0-9]{2}$/.test(patch.stateCode)) throw new ValidationError("State code is the 2-digit GST state code, like 27.");
    set.stateCode = patch.stateCode;
  }
  if (patch.invoicePrefix !== undefined) {
    const p = patch.invoicePrefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(p)) throw new ValidationError("Invoice prefix is 1 to 4 letters or numbers.");
    set.invoicePrefix = p;
  }
  if (patch.branding !== undefined) set.branding = patch.branding;
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new ValidationError("Status is active, suspended or frozen.");
    set.status = patch.status;
  }
  if (patch.trialEndsAt !== undefined) {
    if (patch.trialEndsAt !== null && !isDay(patch.trialEndsAt)) throw new ValidationError("Enter the trial's end date as YYYY-MM-DD.");
    set.trialEndsAt = patch.trialEndsAt;
  }
  return systemDb().transaction(async (tx) => {
    const [before] = await tx.select().from(universities).where(eq(universities.id, universityId)).for("update");
    if (!before) throw new NotFoundError("Institute");
    if (set.slug && set.slug !== before.slug) {
      const [dup] = await tx.select({ id: universities.id }).from(universities).where(eq(universities.slug, set.slug));
      if (dup) throw new ConflictError("Another institute already uses that web address.");
    }
    const [after] = Object.keys(set).length
      ? await tx.update(universities).set(set).where(eq(universities.id, universityId)).returning()
      : [before];
    await tx.insert(auditLog).values({
      universityId,
      actorUserId: actor.userId || null,
      action: "university.update",
      entity: "university",
      entityId: universityId,
      data: patch as Record<string, unknown>,
    });
    return after;
  });
}

function assertSuperAdmin(actor: Actor) {
  const now = new Date();
  if (!actor.assignments.some((a) => a.scopeType === "platform" && a.role === "super_admin" && isActive(a, now))) {
    throw new ForbiddenError("Only a Super Admin can change Zinny team roles.");
  }
}

/**
 * Gives a person a Zinny team role, creating their account if needed. Super Admin only.
 * Emits `user.invited` (with no university) when the person has no password yet.
 */
export async function grantPlatformRole(actor: Actor, given: { email: string; name: string; role: RoleName; customRoleId?: string | null }) {
  assertSuperAdmin(actor);
  const input = given.customRoleId ? { ...given, role: "custom_platform" as const } : given;
  if (!given.customRoleId && input.role === "custom_platform") throw new ValidationError("Pick which custom role to give.");
  if (!PLATFORM_ROLES.includes(input.role)) throw new ValidationError("That isn't a Zinny team role.");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email.");
  if (input.name.trim().length < 2) throw new ValidationError("Enter the person's name.");
  return systemDb().transaction(async (tx) => {
    const custom = input.customRoleId ? await liveCustomRole(tx, null, input.customRoleId) : null;
    const [existing] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    const person = existing ?? (await tx.insert(users).values({ email, name: input.name.trim() }).returning())[0];
    const [dup] = await tx
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, person.id),
          eq(roleAssignments.role, input.role),
          custom ? eq(roleAssignments.customRoleId, custom.id) : isNull(roleAssignments.customRoleId),
          eq(roleAssignments.scopeType, "platform"),
          isNull(roleAssignments.revokedAt),
        ),
      );
    if (dup) return dup;
    const [a] = await tx
      .insert(roleAssignments)
      .values({ userId: person.id, role: input.role, customRoleId: custom?.id ?? null, scopeType: "platform", createdBy: actor.userId || null })
      .returning();
    await tx.insert(auditLog).values({
      universityId: null,
      actorUserId: actor.userId || null,
      action: "platform.role_grant",
      entity: "role_assignment",
      entityId: a.id,
      data: { userId: person.id, role: input.role },
    });
    if (!person.passwordHash) {
      await emitFor(tx, null, actor.userId || null, "user.invited", { userId: person.id, email: person.email, name: person.name, role: input.role });
    }
    return a;
  });
}

/** Removes a Zinny team role. Super Admin only; nobody can remove their own Super Admin role. */
export async function revokePlatformRole(actor: Actor, assignmentId: string) {
  assertSuperAdmin(actor);
  return systemDb().transaction(async (tx) => {
    const [a] = await tx.select().from(roleAssignments).where(eq(roleAssignments.id, assignmentId)).for("update");
    if (!a || a.scopeType !== "platform") throw new NotFoundError("Zinny team role");
    if (a.revokedAt) return;
    if (a.userId === actor.userId && a.role === "super_admin") throw new ValidationError("You can't remove your own Super Admin role.");
    await tx.update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.id, assignmentId));
    await tx.insert(auditLog).values({
      universityId: null,
      actorUserId: actor.userId || null,
      action: "platform.role_revoke",
      entity: "role_assignment",
      entityId: assignmentId,
      data: { userId: a.userId, role: a.role },
    });
  });
}

/** True when the actor holds at least one platform.* action (any Zinny team role). */
export function isZinnyTeam(actor: Actor) {
  return (ACTIONS.filter((a) => a.startsWith("platform.")) as Action[]).some((a) => canPlatform(actor, a));
}

/* ─────────────────────────── Self sign-up and free trials ─────────────────────────── */

export type SelfServeUniversityInput = {
  name: string;
  slug: string;
  legalName: string | null;
  address: string | null;
  /** 2-digit GST state code. */
  stateCode: string;
  /** "Does GST apply when you sell a course?" */
  gstEnabled: boolean;
  /** Required when gstEnabled. */
  gstin: string | null;
  admin: { name: string; email: string; passwordHash: string };
  /** Length of the free trial in days, counted from today in the university's time zone. */
  trialDays: number;
  timezone?: string;
};

export type SelfServeUniversity = { universityId: string; slug: string; userId: string; trialEndsAt: string };

/**
 * An institute signing itself up (the onboarding module's /signup/institute): the university,
 * its first Institute Admin with the password they chose, its GST answer, and a free trial
 * that ends `trialDays` from today. No permission check: anyone may start a trial. The caller
 * validates the form, checks the password and rate-limits. An email that already has an account
 * is refused, so nobody can take over an existing account by signing up with its address.
 */
export async function createSelfServeUniversity(input: SelfServeUniversityInput): Promise<SelfServeUniversity> {
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Give the institute a name.");
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new ValidationError("The web address can use a to z, 0 to 9 and hyphens.");
  if (!/^[0-9]{2}$/.test(input.stateCode)) throw new ValidationError("Pick your state.");
  const gstin = input.gstEnabled ? input.gstin?.trim().toUpperCase() || null : null;
  if (input.gstEnabled && !gstin) throw new ValidationError("Enter your GSTIN, or answer No if GST doesn't apply.");
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new ValidationError("A GSTIN has 15 characters and starts with the 2-digit state code.");
  const email = input.admin.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email.");
  if (input.admin.name.trim().length < 2) throw new ValidationError("Enter the contact person's name.");
  if (!input.admin.passwordHash) throw new ValidationError("Choose a password.");
  if (!Number.isInteger(input.trialDays) || input.trialDays < 1 || input.trialDays > 60) throw new ValidationError("A trial lasts 1 to 60 days.");
  const timezone = input.timezone ?? "Asia/Kolkata";
  if (!validTimezone(timezone)) throw new ValidationError("Pick a valid time zone, like Asia/Kolkata.");
  const trialEndsAt = addDays(todayIn(timezone), input.trialDays);
  const invoicePrefix = (slug.replace(/[^a-z0-9]/g, "").slice(0, 4) || "INST").toUpperCase();

  return systemDb().transaction(async (tx) => {
    const [dupSlug] = await tx.select({ id: universities.id }).from(universities).where(eq(universities.slug, slug));
    if (dupSlug) throw new ConflictError("Another institute already uses that web address. Pick another one.", "slug_taken");
    const [dupUser] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
    if (dupUser) throw new ConflictError("This email already has a Zinny account. Use another email for the institute, or sign in first.", "email_taken");
    const [uni] = await tx
      .insert(universities)
      .values({ name, slug, timezone, legalName: input.legalName?.trim() || null, address: input.address?.trim() || null, stateCode: input.stateCode, gstEnabled: input.gstEnabled, gstin, invoicePrefix, trialEndsAt })
      .returning();
    const [admin] = await tx.insert(users).values({ email, name: input.admin.name.trim(), passwordHash: input.admin.passwordHash }).returning();
    await tx.insert(roleAssignments).values({ userId: admin.id, role: "institute_admin", scopeType: "university", universityId: uni.id, createdBy: admin.id });
    await tx.insert(auditLog).values({
      universityId: uni.id,
      actorUserId: admin.id,
      action: "university.self_signup",
      entity: "university",
      entityId: uni.id,
      data: { name, slug, admin: email, gstEnabled: input.gstEnabled, gstin, stateCode: input.stateCode, trialEndsAt },
    });
    return { universityId: uni.id, slug: uni.slug, userId: admin.id, trialEndsAt };
  });
}

export type TrialPatch = { status?: "active" | "frozen"; trialEndsAt?: string | null };

/**
 * Freezes a university whose free trial ended, unfreezes it once a plan is paid, or moves its
 * trial's end date. Allowed for the Zinny team (platform.manage_universities) and for the
 * university's own system actor (the trial job, and the plan checkout after payment). A
 * suspended university stays suspended: only the Zinny team lifts a suspension. Logged in the
 * university's audit log.
 */
export async function setTrialState(actor: Actor, universityId: string, patch: TrialPatch) {
  const system = actor.userId === "" && actor.universityId === universityId;
  if (!system) assertPlatform(actor, "platform.manage_universities");
  if (patch.status !== undefined && patch.status !== "active" && patch.status !== "frozen") throw new ValidationError("Status is active or frozen.");
  if (patch.trialEndsAt !== undefined && patch.trialEndsAt !== null && !isDay(patch.trialEndsAt)) throw new ValidationError("Enter the trial's end date as YYYY-MM-DD.");
  return systemDb().transaction(async (tx) => {
    const [before] = await tx.select().from(universities).where(eq(universities.id, universityId)).for("update");
    if (!before) throw new NotFoundError("Institute");
    if (patch.status !== undefined && before.status === "suspended") throw new ConflictError("This institute is suspended. Only the Zinny team can reactivate it.", "suspended");
    const set: Partial<typeof universities.$inferInsert> = {};
    if (patch.status !== undefined && patch.status !== before.status) set.status = patch.status;
    if (patch.trialEndsAt !== undefined && patch.trialEndsAt !== before.trialEndsAt) set.trialEndsAt = patch.trialEndsAt;
    if (!Object.keys(set).length) return before;
    const [after] = await tx.update(universities).set(set).where(eq(universities.id, universityId)).returning();
    await tx.insert(auditLog).values({
      universityId,
      actorUserId: actor.userId || null,
      supportSessionId: actor.supportSessionId,
      action: set.status === "frozen" ? "university.freeze" : set.status === "active" ? "university.unfreeze" : "university.trial_update",
      entity: "university",
      entityId: universityId,
      data: { before: { status: before.status, trialEndsAt: before.trialEndsAt }, after: { status: after.status, trialEndsAt: after.trialEndsAt } },
    });
    return after;
  });
}
