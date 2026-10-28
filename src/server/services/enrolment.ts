/**
 * Enrolment (PRD pages 5 and 6):
 *  - The student sees every open batch and picks one. A full batch is shown but can't be picked.
 *  - The seat is held for 10 minutes while they pay, so two students can't get the last seat.
 *  - If the new batch clashes with one they already have, they're warned before enrolling.
 *  - After enrolling they can ask to switch; the HOD approves only if the new batch has a free seat.
 */
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  batchSwitchRequests,
  batches,
  courses,
  departments,
  enrolments,
  orders,
  roleAssignments,
  universities,
  users,
} from "@/db/schema";
import { systemActorFor } from "../actor";
import { assertCan, reach, type Actor } from "../authz/engine";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { todayIn } from "../lib/dates";
import { gateway } from "../payments/gateway";
import { audit, withTenant } from "../tenant";
import { loadBatch, scheduledBatches, seatsTaken } from "./batches";
import { gstFor, issueInvoice } from "./finance";
import { hodsOf, notify } from "./notifications";
import { describeSlots, findClashes, type Clash } from "./schedule";

export const SEAT_HOLD_MINUTES = 10;

function uni(actor: Actor) {
  return actor.universityId!;
}

async function universityToday(tx: Tx, universityId: string) {
  const [u] = await tx.select({ tz: universities.timezone }).from(universities).where(eq(universities.id, universityId));
  return todayIn(u?.tz ?? "Asia/Kolkata");
}

/** Marks holds that ran out as expired and frees their seats. */
export async function expireStaleHolds(tx: Tx, filter: { batchId?: string; userId?: string } = {}) {
  const expired = await tx
    .update(enrolments)
    .set({ status: "expired" })
    .where(
      and(
        eq(enrolments.status, "held"),
        lte(enrolments.holdExpiresAt, sql`now()`),
        filter.batchId ? eq(enrolments.batchId, filter.batchId) : undefined,
        filter.userId ? eq(enrolments.userId, filter.userId) : undefined,
      ),
    )
    .returning({ id: enrolments.id });
  if (expired.length) {
    await tx
      .update(orders)
      .set({ status: "expired" })
      .where(and(eq(orders.status, "pending"), inArray(orders.enrolmentId, expired.map((e) => e.id))));
  }
  return expired.length;
}

/** Batch ids the student currently holds a seat in (paid, or held and not yet expired). */
async function liveBatchIds(tx: Tx, userId: string, opts: { excludeCourseId?: string; excludeEnrolmentId?: string } = {}) {
  const rows = await tx
    .select({ batchId: enrolments.batchId, courseId: enrolments.courseId, id: enrolments.id })
    .from(enrolments)
    .where(
      and(
        eq(enrolments.userId, userId),
        or(eq(enrolments.status, "active"), and(eq(enrolments.status, "held"), gt(enrolments.holdExpiresAt, sql`now()`))),
      ),
    );
  return rows
    .filter((r) => r.courseId !== opts.excludeCourseId && r.id !== opts.excludeEnrolmentId)
    .map((r) => r.batchId);
}

async function clashesFor(tx: Tx, userId: string, candidateBatchId: string, opts: { excludeCourseId?: string; excludeEnrolmentId?: string }) {
  const mine = await liveBatchIds(tx, userId, opts);
  const [candidate] = await scheduledBatches(tx, [candidateBatchId]);
  return findClashes(candidate, await scheduledBatches(tx, mine));
}

/* ─────────────────────────── Learner: browse ─────────────────────────── */

export async function browseCatalog(actor: Actor) {
  assertCan(actor, "catalog.browse", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const today = await universityToday(tx, uni(actor));
    const rows = await tx
      .select({ course: courses, departmentName: departments.name })
      .from(courses)
      .innerJoin(departments, eq(departments.id, courses.departmentId))
      .where(eq(courses.status, "published"))
      .orderBy(courses.title);
    const out = [];
    for (const { course, departmentName } of rows) {
      const open = await tx
        .select({ id: batches.id, seatLimit: batches.seatLimit })
        .from(batches)
        .where(and(eq(batches.courseId, course.id), eq(batches.status, "open"), sql`${batches.endDate} >= ${today}`));
      let seatsLeft = 0;
      for (const b of open) seatsLeft += Math.max(0, b.seatLimit - (await seatsTaken(tx, b.id)));
      out.push({ ...course, departmentName, openBatches: open.length, seatsLeft });
    }
    return out;
  });
}

export type BatchOption = {
  batchId: string;
  name: string;
  timings: string;
  startDate: string;
  endDate: string;
  seatsLeft: number;
  full: boolean;
  faculty: string[];
  clashes: Clash[];
  mine: boolean;
};

/** The batch picker: every open batch, seats left, and whether it clashes with the student's timetable. */
export async function batchOptions(actor: Actor, courseId: string) {
  assertCan(actor, "catalog.browse", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const [course] = await tx.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.status, "published")));
    if (!course) throw new NotFoundError("Course");
    const today = await universityToday(tx, uni(actor));
    const ids = (
      await tx
        .select({ id: batches.id })
        .from(batches)
        .where(and(eq(batches.courseId, courseId), eq(batches.status, "open"), sql`${batches.endDate} >= ${today}`))
    ).map((b) => b.id);
    const sched = await scheduledBatches(tx, ids);
    const [myEnrolment] = await tx
      .select()
      .from(enrolments)
      .where(
        and(
          eq(enrolments.userId, actor.userId),
          eq(enrolments.courseId, courseId),
          or(eq(enrolments.status, "active"), and(eq(enrolments.status, "held"), gt(enrolments.holdExpiresAt, sql`now()`))),
        ),
      );
    const others = await scheduledBatches(tx, await liveBatchIds(tx, actor.userId, { excludeCourseId: courseId }));
    const options: BatchOption[] = [];
    for (const b of sched) {
      const left = Math.max(0, b.seatLimit - (await seatsTaken(tx, b.batchId)));
      options.push({
        batchId: b.batchId,
        name: b.batchName,
        timings: describeSlots(b.slots),
        startDate: b.startDate,
        endDate: b.endDate,
        seatsLeft: left,
        full: left === 0,
        faculty: b.faculty ?? [],
        clashes: findClashes(b, others),
        mine: myEnrolment?.batchId === b.batchId,
      });
    }
    options.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
    return { course, options, myEnrolment: myEnrolment ?? null };
  });
}

/* ─────────────────────────── Learner: enrol ─────────────────────────── */

export type HoldResult =
  | { status: "clash"; clashes: Clash[] }
  | { status: "enrolled"; enrolmentId: string }
  | {
      status: "held";
      enrolmentId: string;
      orderId: string;
      totalPaise: number;
      expiresAt: Date;
      gateway: string;
      checkout: Record<string, unknown>;
    };

export async function holdSeat(actor: Actor, input: { batchId: string; acknowledgeClash?: boolean }): Promise<HoldResult> {
  assertCan(actor, "self.enrol", { universityId: uni(actor), ownerUserId: actor.userId });

  const result = await withTenant(actor, async (tx): Promise<HoldResult> => {
    // Locking the batch row makes seat counting safe when many students click at once.
    const { batch } = await loadBatch(tx, uni(actor), input.batchId, { lock: true });
    const [course] = await tx.select().from(courses).where(eq(courses.id, batch.courseId));
    const today = await universityToday(tx, uni(actor));
    if (course.status !== "published" || batch.status !== "open" || batch.endDate < today) {
      throw new ConflictError("This batch is not open for enrolment.", "batch_closed");
    }
    await expireStaleHolds(tx, { batchId: batch.id });
    await expireStaleHolds(tx, { userId: actor.userId });

    const [live] = await tx
      .select()
      .from(enrolments)
      .where(and(eq(enrolments.userId, actor.userId), eq(enrolments.courseId, course.id), inArray(enrolments.status, ["held", "active"])));
    if (live?.status === "active") throw new ConflictError("You're already enrolled in this course.", "already_enrolled");
    if (live?.status === "held") {
      if (live.batchId === batch.id) {
        const [order] = await tx.select().from(orders).where(eq(orders.enrolmentId, live.id));
        return {
          status: "held",
          enrolmentId: live.id,
          orderId: order.id,
          totalPaise: order.totalPaise,
          expiresAt: live.holdExpiresAt!,
          gateway: order.gateway,
          checkout: order.gatewayOrderId ? { order_id: order.gatewayOrderId, resumed: true } : {},
        };
      }
      // Changed their mind about the batch: release the old hold.
      await tx.update(enrolments).set({ status: "cancelled" }).where(eq(enrolments.id, live.id));
      await tx.update(orders).set({ status: "expired" }).where(and(eq(orders.enrolmentId, live.id), eq(orders.status, "pending")));
    }

    if ((await seatsTaken(tx, batch.id)) >= batch.seatLimit) {
      throw new ConflictError("This batch is full. Pick another batch.", "batch_full");
    }

    const clashes = await clashesFor(tx, actor.userId, batch.id, { excludeCourseId: course.id });
    if (clashes.length > 0 && !input.acknowledgeClash) return { status: "clash", clashes };

    if (course.pricePaise === 0) {
      const [e] = await tx
        .insert(enrolments)
        .values({ universityId: uni(actor), userId: actor.userId, courseId: course.id, batchId: batch.id, status: "active", enrolledAt: new Date() })
        .returning();
      await notify(tx, uni(actor), [actor.userId], {
        kind: "enrolment.confirmed",
        title: `You're enrolled in ${course.title}`,
        body: `${batch.name} starts on ${batch.startDate}. It's on your timetable now.`,
        data: { courseId: course.id, batchId: batch.id },
      });
      await audit(tx, actor, "enrolment.create", "enrolment", e.id, { batchId: batch.id, free: true, clashAcknowledged: clashes.length > 0 });
      return { status: "enrolled", enrolmentId: e.id };
    }

    const expiresAt = new Date(Date.now() + SEAT_HOLD_MINUTES * 60_000);
    const [e] = await tx
      .insert(enrolments)
      .values({ universityId: uni(actor), userId: actor.userId, courseId: course.id, batchId: batch.id, status: "held", holdExpiresAt: expiresAt })
      .returning();
    const gst = gstFor(course.pricePaise, course.gstRateBp);
    const [order] = await tx
      .insert(orders)
      .values({
        universityId: uni(actor),
        userId: actor.userId,
        courseId: course.id,
        batchId: batch.id,
        enrolmentId: e.id,
        basePaise: course.pricePaise,
        gstPaise: gst,
        totalPaise: course.pricePaise + gst,
        gateway: gateway().name,
      })
      .returning();
    await audit(tx, actor, "enrolment.hold", "enrolment", e.id, { batchId: batch.id, orderId: order.id, clashAcknowledged: clashes.length > 0 });
    return { status: "held", enrolmentId: e.id, orderId: order.id, totalPaise: order.totalPaise, expiresAt, gateway: order.gateway, checkout: {} };
  }).catch((err) => {
    // Two tabs racing for the same course: the unique index stops a second live seat.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505")
      throw new ConflictError("You already have a seat in this course.", "already_enrolled");
    throw err;
  });

  // Create the payment order with the gateway after the seat is safely held (no network call inside the lock).
  if (result.status === "held" && Object.keys(result.checkout).length === 0) {
    const g = gateway();
    const go = await g.createOrder({ amountPaise: result.totalPaise, receipt: result.orderId, notes: { orderId: result.orderId, universityId: uni(actor) } });
    await withTenant(actor, (tx) => tx.update(orders).set({ gatewayOrderId: go.gatewayOrderId }).where(eq(orders.id, result.orderId)));
    result.checkout = go.checkout;
  }
  return result;
}

export type PaymentOutcome = { status: "enrolled" | "already_paid" | "refund_due"; enrolmentId: string; invoiceNumber?: string };

/**
 * Called when the gateway confirms payment (webhook or verified checkout callback).
 * If the hold ran out but a seat is still free, the student still gets in.
 * If the batch filled up meanwhile, the order is flagged for a refund.
 */
export async function confirmPayment(universityId: string, input: { orderId: string; gatewayPaymentId: string }): Promise<PaymentOutcome> {
  const sys = systemActorFor(universityId);
  return withTenant(sys, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order || !order.enrolmentId) throw new NotFoundError("Order");
    if (order.status === "paid") return { status: "already_paid", enrolmentId: order.enrolmentId };
    if (order.status === "refund_due" || order.status === "refunded")
      return { status: "refund_due", enrolmentId: order.enrolmentId };

    const { batch } = await loadBatch(tx, universityId, order.batchId, { lock: true });
    const [course] = await tx.select().from(courses).where(eq(courses.id, order.courseId));
    const [enrolment] = await tx.select().from(enrolments).where(eq(enrolments.id, order.enrolmentId));

    const holdValid = enrolment.status === "held" && enrolment.holdExpiresAt! > new Date();
    let canActivate = holdValid;
    if (!holdValid) {
      const [otherLive] = await tx
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(
          and(
            eq(enrolments.userId, order.userId),
            eq(enrolments.courseId, order.courseId),
            inArray(enrolments.status, ["held", "active"]),
            sql`${enrolments.id} <> ${enrolment.id}`,
          ),
        );
      canActivate = !otherLive && (await seatsTaken(tx, batch.id, enrolment.id)) < batch.seatLimit;
    }

    await tx.update(orders).set({ gatewayPaymentId: input.gatewayPaymentId, paidAt: new Date() }).where(eq(orders.id, order.id));

    if (!canActivate) {
      await tx.update(orders).set({ status: "refund_due" }).where(eq(orders.id, order.id));
      await tx.update(enrolments).set({ status: "expired" }).where(eq(enrolments.id, enrolment.id));
      const finance = await tx
        .select({ userId: roleAssignments.userId })
        .from(roleAssignments)
        .where(and(inArray(roleAssignments.role, ["accounts_fees", "institute_admin"]), isNull(roleAssignments.revokedAt)));
      await notify(tx, universityId, [order.userId], {
        kind: "payment.refund_due",
        title: `${batch.name} filled up before your payment finished`,
        body: "Your payment will be refunded in full. You can pick another batch.",
        data: { orderId: order.id },
      });
      await notify(tx, universityId, finance.map((f) => f.userId), {
        kind: "finance.refund_due",
        title: "Refund needed",
        body: `${course.title} — ${batch.name}: paid after the seat hold ran out and the batch was full.`,
        data: { orderId: order.id },
      });
      await audit(tx, sys, "payment.refund_due", "order", order.id, { gatewayPaymentId: input.gatewayPaymentId });
      return { status: "refund_due", enrolmentId: enrolment.id };
    }

    await tx
      .update(enrolments)
      .set({ status: "active", enrolledAt: new Date(), holdExpiresAt: null })
      .where(eq(enrolments.id, enrolment.id));
    await tx.update(orders).set({ status: "paid" }).where(eq(orders.id, order.id));
    const invoice = await issueInvoice(tx, order.id);
    await notify(tx, universityId, [order.userId], {
      kind: "enrolment.confirmed",
      title: `You're enrolled in ${course.title}`,
      body: `${batch.name} starts on ${batch.startDate}. Invoice ${invoice.number} is ready.`,
      data: { courseId: course.id, batchId: batch.id, invoiceId: invoice.id },
    });
    await audit(tx, sys, "payment.confirmed", "order", order.id, { gatewayPaymentId: input.gatewayPaymentId, invoice: invoice.number });
    return { status: "enrolled", enrolmentId: enrolment.id, invoiceNumber: invoice.number };
  });
}

/** Payment failed or was abandoned: free the seat now instead of waiting for the hold to run out. */
export async function failPayment(universityId: string, orderId: string) {
  const sys = systemActorFor(universityId);
  return withTenant(sys, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.status !== "pending") return;
    await tx.update(orders).set({ status: "failed" }).where(eq(orders.id, orderId));
    if (order.enrolmentId) {
      await tx.update(enrolments).set({ status: "cancelled" }).where(and(eq(enrolments.id, order.enrolmentId), eq(enrolments.status, "held")));
    }
    await audit(tx, sys, "payment.failed", "order", orderId);
  });
}

/** The student cancels their own pending checkout. */
export async function cancelHold(actor: Actor, enrolmentId: string) {
  return withTenant(actor, async (tx) => {
    const [e] = await tx.select().from(enrolments).where(eq(enrolments.id, enrolmentId));
    if (!e || e.userId !== actor.userId) throw new NotFoundError("Enrolment");
    if (e.status !== "held") return;
    await tx.update(enrolments).set({ status: "cancelled" }).where(eq(enrolments.id, enrolmentId));
    await tx.update(orders).set({ status: "expired" }).where(and(eq(orders.enrolmentId, enrolmentId), eq(orders.status, "pending")));
    await audit(tx, actor, "enrolment.cancel_hold", "enrolment", enrolmentId);
  });
}

/* ─────────────────────────── Batch switching ─────────────────────────── */

export type SwitchResult = { status: "clash"; clashes: Clash[] } | { status: "requested"; requestId: string };

export async function requestSwitch(
  actor: Actor,
  input: { enrolmentId: string; toBatchId: string; reason?: string; acknowledgeClash?: boolean },
): Promise<SwitchResult> {
  assertCan(actor, "self.switch_batch", { universityId: uni(actor), ownerUserId: actor.userId });
  return withTenant(actor, async (tx) => {
    const [e] = await tx.select().from(enrolments).where(eq(enrolments.id, input.enrolmentId));
    if (!e || e.userId !== actor.userId) throw new NotFoundError("Enrolment");
    if (e.status !== "active") throw new ConflictError("Only an active enrolment can switch batch.");
    const { batch: to } = await loadBatch(tx, uni(actor), input.toBatchId);
    const today = await universityToday(tx, uni(actor));
    if (to.courseId !== e.courseId) throw new ValidationError("You can only switch to a batch of the same course.");
    if (to.id === e.batchId) throw new ValidationError("You're already in this batch.");
    if (to.status !== "open" || to.endDate < today) throw new ConflictError("That batch is not open.", "batch_closed");
    if ((await seatsTaken(tx, to.id)) >= to.seatLimit) throw new ConflictError("That batch is full.", "batch_full");

    const [pending] = await tx
      .select()
      .from(batchSwitchRequests)
      .where(and(eq(batchSwitchRequests.enrolmentId, e.id), eq(batchSwitchRequests.status, "pending")));
    if (pending) throw new ConflictError("You already have a switch request waiting for approval.", "switch_pending");

    const clashes = await clashesFor(tx, actor.userId, to.id, { excludeEnrolmentId: e.id });
    if (clashes.length > 0 && !input.acknowledgeClash) return { status: "clash", clashes };

    const [req] = await tx
      .insert(batchSwitchRequests)
      .values({ universityId: uni(actor), enrolmentId: e.id, fromBatchId: e.batchId, toBatchId: to.id, reason: input.reason?.trim() || null })
      .returning();
    const [course] = await tx.select().from(courses).where(eq(courses.id, e.courseId));
    const [from] = await tx.select().from(batches).where(eq(batches.id, e.batchId));
    await notify(tx, uni(actor), await hodsOf(tx, to.departmentId), {
      kind: "switch.requested",
      title: `Batch switch request: ${course.title}`,
      body: `${actor.name} wants to move from ${from.name} to ${to.name}.`,
      data: { requestId: req.id },
    });
    await audit(tx, actor, "switch.request", "batch_switch_request", req.id, { from: e.batchId, to: to.id, clashAcknowledged: clashes.length > 0 });
    return { status: "requested", requestId: req.id };
  });
}

export async function cancelSwitch(actor: Actor, requestId: string) {
  return withTenant(actor, async (tx) => {
    const [req] = await tx.select().from(batchSwitchRequests).where(eq(batchSwitchRequests.id, requestId));
    if (!req) throw new NotFoundError("Request");
    const [e] = await tx.select().from(enrolments).where(eq(enrolments.id, req.enrolmentId));
    if (e.userId !== actor.userId) throw new NotFoundError("Request");
    if (req.status !== "pending") return;
    await tx.update(batchSwitchRequests).set({ status: "cancelled" }).where(eq(batchSwitchRequests.id, requestId));
    await audit(tx, actor, "switch.cancel", "batch_switch_request", requestId);
  });
}

export type DecisionResult = { status: "approved" | "rejected"; reason?: "batch_full" | "not_active" | "by_hod" };

export async function decideSwitch(actor: Actor, requestId: string, input: { approve: boolean; note?: string }): Promise<DecisionResult> {
  return withTenant(actor, async (tx) => {
    const [req] = await tx.select().from(batchSwitchRequests).where(eq(batchSwitchRequests.id, requestId)).for("update");
    if (!req) throw new NotFoundError("Request");
    const { batch: to, target } = await loadBatch(tx, uni(actor), req.toBatchId, { lock: true });
    assertCan(actor, "batch.switch.decide", target);
    if (req.status !== "pending") throw new ConflictError("This request was already decided.");
    const [e] = await tx.select().from(enrolments).where(eq(enrolments.id, req.enrolmentId));
    const [course] = await tx.select().from(courses).where(eq(courses.id, e.courseId));

    const close = async (status: "approved" | "rejected", note: string | null) => {
      await tx
        .update(batchSwitchRequests)
        .set({ status, decidedBy: actor.userId || null, decidedAt: new Date(), decisionNote: note })
        .where(eq(batchSwitchRequests.id, requestId));
    };

    let result: DecisionResult;
    if (!input.approve) {
      await close("rejected", input.note?.trim() || null);
      result = { status: "rejected", reason: "by_hod" };
    } else if (e.status !== "active") {
      await close("rejected", "Enrolment is no longer active.");
      result = { status: "rejected", reason: "not_active" };
    } else if ((await seatsTaken(tx, to.id)) >= to.seatLimit) {
      await close("rejected", `No free seat in ${to.name}.`);
      result = { status: "rejected", reason: "batch_full" };
    } else {
      await tx.update(enrolments).set({ batchId: to.id }).where(eq(enrolments.id, e.id));
      await close("approved", input.note?.trim() || null);
      result = { status: "approved" };
    }

    await notify(tx, uni(actor), [e.userId], {
      kind: `switch.${result.status}`,
      title:
        result.status === "approved"
          ? `You've moved to ${to.name} (${course.title})`
          : `Your switch to ${to.name} was not approved`,
      body:
        result.status === "approved"
          ? "Your timetable is updated."
          : result.reason === "batch_full"
            ? "That batch has no free seat now."
            : (input.note ?? ""),
      data: { requestId },
    });
    await audit(tx, actor, `switch.${result.status}`, "batch_switch_request", requestId, { reason: result.reason ?? null });
    return result;
  });
}

/** Approvals inbox for HODs (and admins). */
export async function listSwitchRequests(actor: Actor, status: "pending" | "approved" | "rejected" | "cancelled" = "pending") {
  const r = reach(actor, "batch.switch.decide", uni(actor));
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        id: batchSwitchRequests.id,
        status: batchSwitchRequests.status,
        reason: batchSwitchRequests.reason,
        createdAt: batchSwitchRequests.createdAt,
        decisionNote: batchSwitchRequests.decisionNote,
        student: users.name,
        studentEmail: users.email,
        course: courses.title,
        fromBatchId: batchSwitchRequests.fromBatchId,
        toBatchId: batchSwitchRequests.toBatchId,
        departmentId: batches.departmentId,
        toBatchName: batches.name,
        toSeatLimit: batches.seatLimit,
      })
      .from(batchSwitchRequests)
      .innerJoin(enrolments, eq(enrolments.id, batchSwitchRequests.enrolmentId))
      .innerJoin(users, eq(users.id, enrolments.userId))
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(batches, eq(batches.id, batchSwitchRequests.toBatchId))
      .where(eq(batchSwitchRequests.status, status))
      .orderBy(desc(batchSwitchRequests.createdAt));
    const visible = rows.filter((x) => r.all || r.departmentIds.has(x.departmentId));
    const fromNames = new Map(
      (visible.length
        ? await tx.select({ id: batches.id, name: batches.name }).from(batches).where(inArray(batches.id, visible.map((v) => v.fromBatchId)))
        : []
      ).map((b) => [b.id, b.name]),
    );
    const out = [];
    for (const v of visible) {
      out.push({ ...v, fromBatchName: fromNames.get(v.fromBatchId) ?? "", toSeatsLeft: Math.max(0, v.toSeatLimit - (await seatsTaken(tx, v.toBatchId))) });
    }
    return out;
  });
}

/* ─────────────────────────── Learner: my courses ─────────────────────────── */

export async function myLearning(actor: Actor) {
  assertCan(actor, "self.view_learning", { universityId: uni(actor), ownerUserId: actor.userId });
  return withTenant(actor, async (tx) => {
    await expireStaleHolds(tx, { userId: actor.userId });
    const rows = await tx
      .select({ enrolment: enrolments, course: courses, batchName: batches.name })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .where(and(eq(enrolments.userId, actor.userId), inArray(enrolments.status, ["active", "held", "completed"])))
      .orderBy(courses.title);
    const sched = await scheduledBatches(tx, rows.map((r) => r.enrolment.batchId));
    const requests = rows.length
      ? await tx
          .select()
          .from(batchSwitchRequests)
          .where(inArray(batchSwitchRequests.enrolmentId, rows.map((r) => r.enrolment.id)))
          .orderBy(desc(batchSwitchRequests.createdAt))
      : [];
    return rows.map((r) => {
      const s = sched.find((x) => x.batchId === r.enrolment.batchId)!;
      return {
        enrolmentId: r.enrolment.id,
        status: r.enrolment.status,
        holdExpiresAt: r.enrolment.holdExpiresAt,
        course: { id: r.course.id, title: r.course.title },
        batch: { id: r.enrolment.batchId, name: r.batchName, timings: describeSlots(s.slots), startDate: s.startDate, endDate: s.endDate, faculty: s.faculty ?? [] },
        switchRequest: requests.find((q) => q.enrolmentId === r.enrolment.id && q.status === "pending") ?? null,
        lastDecision: requests.find((q) => q.enrolmentId === r.enrolment.id && q.status !== "pending") ?? null,
      };
    });
  });
}

/** Pending order for the student's own checkout page. */
export async function myOrder(actor: Actor, orderId: string) {
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .select({ order: orders, course: courses.title, batch: batches.name, enrolment: enrolments })
      .from(orders)
      .innerJoin(courses, eq(courses.id, orders.courseId))
      .innerJoin(batches, eq(batches.id, orders.batchId))
      .innerJoin(enrolments, eq(enrolments.id, orders.enrolmentId))
      .where(eq(orders.id, orderId));
    if (!row || row.order.userId !== actor.userId) throw new NotFoundError("Order");
    return row;
  });
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
