"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { confirmPayment, orderForCheckout } from "@/server/core";
import { testPaymentsAllowed } from "@/server/payments/gateway";
import { cancelHold, cancelSwitch, holdSeat, requestSwitch } from "@/server/services/enrolment";
import type { Clash } from "@/server/services/schedule";

export type EnrolState = (NonNullable<ActionState> & { clashes?: Clash[]; batchId?: string }) | null;

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

/** Pick a batch. If it clashes, show the warning first; "Enrol anyway" sends acknowledge=1. */
export async function enrolAction(_: EnrolState, data: FormData): Promise<EnrolState> {
  const { uni, actor } = await ctx(data);
  const batchId = str(data, "batchId");
  let next: string | null = null;
  let clashes: Clash[] | undefined;
  const res = await attempt(async () => {
    if (!batchId) throw new ValidationError("Pick a batch first.");
    const r = await holdSeat(actor, { batchId, acknowledgeClash: str(data, "acknowledge") === "1" });
    if (r.status === "clash") {
      clashes = r.clashes;
      return "";
    }
    next = r.status === "held" ? `/${uni}/learn/checkout/${r.orderId}` : `/${uni}/learn/timetable?enrolled=1`;
  });
  if (next) redirect(next);
  return clashes ? { clashes, batchId, at: Date.now() } : res;
}

/**
 * Test-mode payment: the mock gateway only, and only in development or with ZINNY_DEMO=1
 * (`testPaymentsAllowed`). With Razorpay keys set, the Razorpay checkout and webhook do this
 * instead. The payments checkout has its own test button; nothing in core renders one now.
 */
export async function payTestAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const orderId = str(data, "orderId");
  let done = false;
  const res = await attempt(async () => {
    if (!testPaymentsAllowed()) throw new ForbiddenError("Test payments are off on this site. Use the real checkout.");
    const { order } = await orderForCheckout(actor, orderId);
    const out = await confirmPayment(order.universityId, { orderId, gatewayPaymentId: `mock_pay_${Date.now()}` });
    if (out.status === "refund_due") throw new ValidationError("The batch filled up before payment finished. Your money will be refunded.");
    done = true;
  });
  if (done) redirect(`/${uni}/learn/timetable?enrolled=1`);
  return res;
}

export async function cancelHoldAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  await cancelHold(actor, str(data, "enrolmentId"));
  redirect(`/${uni}/learn/courses`);
}

export async function requestSwitchAction(_: EnrolState, data: FormData): Promise<EnrolState> {
  const { uni, actor } = await ctx(data);
  let clashes: Clash[] | undefined;
  const res = await attempt(async () => {
    const toBatchId = str(data, "batchId");
    if (!toBatchId) throw new ValidationError("Pick the batch you want to move to.");
    const r = await requestSwitch(actor, {
      enrolmentId: str(data, "enrolmentId"),
      toBatchId,
      reason: str(data, "reason"),
      acknowledgeClash: str(data, "acknowledge") === "1",
    });
    if (r.status === "clash") {
      clashes = r.clashes;
      return "";
    }
    revalidatePath(`/${uni}/learn`, "layout");
    return "Request sent to your Head of Department. You'll get a notification when they decide.";
  });
  return clashes ? { clashes, batchId: str(data, "batchId"), at: Date.now() } : res;
}

export async function cancelSwitchAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await cancelSwitch(actor, str(data, "requestId"));
    revalidatePath(`/${uni}/learn`, "layout");
    return "Request withdrawn.";
  });
}
