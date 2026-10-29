"use server";

/**
 * Server actions for payments. Each one builds the actor from the session for the
 * university in the URL and calls a service; the services check every permission.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { AppError, ValidationError } from "@/server/errors";
import { abandonCheckout, failInTestMode, payInTestMode, verifyCheckoutPayment, type PaymentConfirmation } from "./checkout";
import { parseRupees } from "./money";
import { refundOrder } from "./refunds";
import { updateInvoiceSettings } from "./settings";

const SLUG = /^[a-z0-9-]{2,40}$/;

async function ctx(uni: string) {
  if (!SLUG.test(uni)) throw new ValidationError("Unknown university.");
  const { actor } = await spaceContext(uni);
  return actor;
}

function afterPayment(uni: string, orderId: string, out: PaymentConfirmation) {
  return out.status === "refund_due" ? `/${uni}/learn/checkout/${orderId}` : `/${uni}/learn/timetable?enrolled=1`;
}

type ClientResult = { ok: true; next?: string } | { ok: false; error: string };

async function clientAttempt(fn: () => Promise<string | undefined>): Promise<ClientResult> {
  try {
    const next = await fn();
    return { ok: true, next };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[payments]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Razorpay Checkout success callback: verify the signature, then enrol. */
export async function verifyRazorpayAction(input: {
  uni: string;
  orderId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<ClientResult> {
  return clientAttempt(async () => {
    const actor = await ctx(String(input.uni));
    const out = await verifyCheckoutPayment(actor, {
      orderId: String(input.orderId),
      razorpayOrderId: String(input.razorpay_order_id ?? ""),
      razorpayPaymentId: String(input.razorpay_payment_id ?? ""),
      signature: String(input.razorpay_signature ?? ""),
    });
    return afterPayment(input.uni, input.orderId, out);
  });
}

/** Razorpay Checkout closed without paying, or a payment attempt failed: release the seat. */
export async function abandonCheckoutAction(input: {
  uni: string;
  orderId: string;
  reason: "dismissed" | "failed";
  code?: string;
  description?: string;
}): Promise<ClientResult> {
  return clientAttempt(async () => {
    const actor = await ctx(String(input.uni));
    await abandonCheckout(actor, String(input.orderId), {
      reason: input.reason === "failed" ? "failed" : "dismissed",
      code: input.code ? String(input.code) : undefined,
      description: input.description ? String(input.description) : undefined,
    });
    revalidatePath(`/${input.uni}/learn/checkout/${input.orderId}`);
    return undefined;
  });
}

/** Test-mode payment (mock gateway only). */
export async function payTestModeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const orderId = str(data, "orderId");
  let next: string | null = null;
  const res = await attempt(async () => {
    const actor = await ctx(uni);
    next = afterPayment(uni, orderId, await payInTestMode(actor, orderId));
  });
  if (next) redirect(next);
  return res;
}

/** Test-mode failed payment: releases the seat like a real failure would. */
export async function failTestModeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const orderId = str(data, "orderId");
  const res = await attempt(async () => {
    await failInTestMode(await ctx(uni), orderId);
    revalidatePath(`/${uni}/learn/checkout/${orderId}`);
  });
  return res?.error ? res : null;
}

/** The student gives up this checkout: the seat is released and they pick a batch again. */
export async function cancelCheckoutAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const orderId = str(data, "orderId");
  const courseId = str(data, "courseId");
  const res = await attempt(async () => {
    await abandonCheckout(await ctx(uni), orderId, { reason: "dismissed", description: "Cancelled on the checkout page" });
  });
  if (res?.error) return res;
  redirect(/^[0-9a-f-]{36}$/i.test(courseId) ? `/${uni}/learn/courses/${courseId}` : `/${uni}/learn/courses`);
}

/** Sales: full or partial refund. */
export async function refundAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const orderId = str(data, "orderId");
  return attempt(async () => {
    const actor = await ctx(uni);
    const amountPaise = parseRupees(str(data, "amount"));
    if (amountPaise === null) throw new ValidationError("Enter the amount in rupees, like 1000 or 1000.50.");
    const out = await refundOrder(actor, { orderId, amountPaise, reason: str(data, "reason") });
    revalidatePath(`/${uni}/admin/finance/sales`);
    return out.message;
  });
}

/** Sales → Invoice settings. */
export async function saveInvoiceSettingsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const actor = await ctx(uni);
    await updateInvoiceSettings(actor, { sacCode: str(data, "sacCode"), invoiceFooter: String(data.get("invoiceFooter") ?? "") });
    revalidatePath(`/${uni}/admin/finance/sales/settings`);
    return "Invoice settings saved. New invoices use them; invoices already issued don't change.";
  });
}
