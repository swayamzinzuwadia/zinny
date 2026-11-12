"use server";

/** Server actions for the marketplace. They only call services; the services check every permission. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, rupeesToPaise, str } from "@/server/action";
import { currentUserId } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { inr } from "@/modules/payments/money";
import { startBundle } from "@/modules/payments/bundles";
import { createBatchListing, createCode, createCombo, createListing, removeBatchListing, setCodeStatus, setListingStatus, updateListing } from "./listings";
import { addToCart, cartCount, removeFromCart } from "./cart";
import { quoteCode, startPurchase } from "./service";

/** Everywhere a listing shows: the admin pages, the course editor, the catalogue and the institute's website. */
function refresh(uni: string) {
  revalidatePath(`/${uni}/admin/marketplace`, "layout");
  revalidatePath(`/${uni}/admin/products/courses`, "layout");
  revalidatePath("/marketplace", "layout");
  revalidatePath(`/site/${uni}`);
}

/** "Buy": holds the purchase at the price after any code and opens checkout at the selling institute. "Apply" only shows that price. */
export async function buyAction(_: ActionState, data: FormData): Promise<ActionState> {
  const listingId = str(data, "listingId");
  const code = str(data, "code");
  if (str(data, "intent") === "apply") {
    return attempt(async () => {
      if (!code) throw new ValidationError("Type a code first.");
      const q = await quoteCode(listingId, code);
      return `Code applied: ${inr(q.pricePaise)}, saving ${inr(q.savedPaise)}. If the institute charges GST, it is added at checkout.`;
    });
  }
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/marketplace/${listingId}`)}`);
  let dest: string | null = null;
  const res = await attempt(async () => {
    const { slug, orderId, live } = await startPurchase(userId, listingId, code);
    // A seat in a live batch is paid for on the marketplace's own checkout: the institute's
    // checkout page leads back to its course catalogue, which a marketplace buyer can't open.
    dest = live ? `/marketplace/checkout/${(await startBundle(userId, [orderId])).bundleId}` : `/${slug}/learn/checkout/${orderId}`;
  });
  if (dest) redirect(dest);
  return res;
}

/** An empty compare-at price means no deal. */
const fieldsOf = (data: FormData) => ({
  title: str(data, "title"),
  description: str(data, "description"),
  pricePaise: rupeesToPaise(str(data, "price")),
  compareAtPaise: str(data, "compareAt") ? rupeesToPaise(str(data, "compareAt")) : null,
});

export async function createListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const [kind, sourceId] = str(data, "source").split(":");
    if ((kind !== "course" && kind !== "lecture") || !sourceId) throw new ValidationError("Choose a course or lecture to sell.");
    await createListing(actor, { kind, sourceId, ...fieldsOf(data) });
    refresh(uni);
    return "Listed. It's on the marketplace now.";
  });
}

/** "List a live batch": a seat in a real batch, at the marketplace price. The title is the course's own. */
export async function createBatchListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const batchId = str(data, "batchId");
    if (!batchId) throw new ValidationError("Choose the batch to list.");
    await createBatchListing(actor, {
      batchId,
      description: str(data, "description"),
      pricePaise: rupeesToPaise(str(data, "price")),
      compareAtPaise: str(data, "compareAt") ? rupeesToPaise(str(data, "compareAt")) : null,
      lateJoin: data.get("lateJoin") === "on",
    });
    refresh(uni);
    return "Listed. Seats in this batch are on the marketplace now.";
  });
}

/** "Remove from the marketplace", for a live batch. Goes back to the listings once it is gone. */
export async function removeListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  let done = false;
  const res = await attempt(async () => {
    const { actor } = await spaceContext(uni);
    await removeBatchListing(actor, str(data, "listingId"));
    refresh(uni);
    done = true;
  });
  if (done) redirect(`/${uni}/admin/marketplace`);
  return res;
}

export async function updateListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    // The late-joining tick is only on a live batch's form; a marker field tells an unticked box from no box.
    const lateJoin = data.has("hasLateJoin") ? { lateJoin: data.get("lateJoin") === "on" } : {};
    await updateListing(actor, str(data, "listingId"), { ...fieldsOf(data), ...lateJoin });
    refresh(uni);
    return "Listing saved. New buyers see these details and this price.";
  });
}

export async function setListingStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const status = str(data, "status") === "live" ? "live" : "paused";
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    await setListingStatus(actor, str(data, "listingId"), status);
    refresh(uni);
    return status === "live" ? "Back on the marketplace." : "Taken off the marketplace. People who bought it keep their access.";
  });
}

export async function createComboAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const courseIds = data.getAll("courseIds").map(String).filter(Boolean);
    await createCombo(actor, { courseIds, ...fieldsOf(data) });
    refresh(uni);
    return "Combo listed. It's on the marketplace now.";
  });
}

export async function createCodeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const kind = str(data, "kind") === "amount" ? "amount" : "percent";
    const raw = str(data, "value");
    const code = await createCode(actor, {
      code: str(data, "code"),
      kind,
      value: kind === "amount" ? rupeesToPaise(raw) : Math.round(Number(raw)),
      listingId: str(data, "listingId") || null,
      startsOn: str(data, "startsOn") || null,
      endsOn: str(data, "endsOn") || null,
      maxUses: str(data, "maxUses") ? Math.round(Number(str(data, "maxUses"))) : null,
    });
    refresh(uni);
    return `Code ${code.code} is ready. Buyers type it on the course page before they pay.`;
  });
}

export async function setCodeStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const status = str(data, "status") === "active" ? "active" : "paused";
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    await setCodeStatus(actor, str(data, "codeId"), status);
    refresh(uni);
    return status === "active" ? "Code switched back on." : "Code paused. Nobody can use it until you switch it back on.";
  });
}

/* ───────────────────────────── Cart ───────────────────────────── */

export type CartResult = { ok: true; count: number } | { ok: false; error: string; signIn?: boolean };

/** "Add to cart", called from the listing page so its animation can start straight away. */
export async function addToCartAction(listingId: string): Promise<CartResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to add this to your cart.", signIn: true };
  const res = await attempt(async () => {
    await addToCart(userId, String(listingId));
  });
  if (res && "error" in res && res.error) return { ok: false, error: res.error };
  // No revalidation here: the header badge takes the new count when the basket lands in it.
  return { ok: true, count: await cartCount(userId) };
}

export async function removeFromCartAction(_: ActionState, data: FormData): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace/cart");
  return attempt(async () => {
    await removeFromCart(userId, str(data, "listingId"));
    revalidatePath("/marketplace", "layout");
    return "Taken out of your cart.";
  });
}
