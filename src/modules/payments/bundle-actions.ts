"use server";

/** Server actions for paying a marketplace cart in one go (bundles.ts). The services check that the bundle is the learner's own. */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { currentUserId } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { abandonBundle, payBundleInTestMode, verifyBundlePayment } from "./bundles";

type ClientResult = { ok: true; next?: string } | { ok: false; error: string };

async function me(bundleId: string) {
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/marketplace/checkout/${bundleId}`)}`);
  return userId;
}

async function clientAttempt(fn: () => Promise<string | undefined>): Promise<ClientResult> {
  try {
    return { ok: true, next: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[payments] bundle", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Razorpay Checkout success callback for a cart: verify, then confirm every order in it. */
export async function verifyBundleAction(input: { bundleId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }): Promise<ClientResult> {
  const bundleId = String(input.bundleId);
  const userId = await me(bundleId);
  return clientAttempt(async () => {
    await verifyBundlePayment(userId, {
      bundleId,
      razorpayOrderId: String(input.razorpay_order_id ?? ""),
      razorpayPaymentId: String(input.razorpay_payment_id ?? ""),
      signature: String(input.razorpay_signature ?? ""),
    });
    return "/marketplace/library?bought=1";
  });
}

/** Razorpay Checkout closed without paying, or a payment failed: release every seat in the cart. */
export async function abandonBundleAction(input: { bundleId: string }): Promise<ClientResult> {
  const bundleId = String(input.bundleId);
  const userId = await me(bundleId);
  return clientAttempt(async () => {
    await abandonBundle(userId, bundleId);
    revalidatePath(`/marketplace/checkout/${bundleId}`);
    return undefined;
  });
}

/** Test-mode payment for a cart (mock gateway only). */
export async function payBundleTestModeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const bundleId = str(data, "bundleId");
  const userId = await me(bundleId);
  let paid = false;
  const res = await attempt(async () => {
    await payBundleInTestMode(userId, bundleId);
    paid = true;
  });
  if (paid) redirect("/marketplace/library?bought=1");
  return res;
}

/** The learner gives up this checkout: every seat is released and the cart is kept. */
export async function cancelBundleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const bundleId = str(data, "bundleId");
  const userId = await me(bundleId);
  const res = await attempt(async () => {
    await abandonBundle(userId, bundleId);
  });
  if (res?.error) return res;
  redirect("/marketplace/cart");
}
