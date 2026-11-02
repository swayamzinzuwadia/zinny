"use server";

/**
 * Checking out a cart joins two modules: the marketplace holds each course as its own order,
 * then payments takes one payment for all of them. Both services check the learner.
 */
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { currentUserId } from "@/server/auth/session";
import { checkoutCart } from "@/modules/marketplace/cart";
import { startBundle } from "@/modules/payments/bundles";

export async function checkoutCartAction(_: ActionState, data: FormData): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace/cart");
  let bundleId: string | null = null;
  const res = await attempt(async () => {
    const { orderIds } = await checkoutCart(userId, str(data, "code") || undefined);
    bundleId = (await startBundle(userId, orderIds)).bundleId;
  });
  if (bundleId) redirect(`/marketplace/checkout/${bundleId}`);
  return res;
}
