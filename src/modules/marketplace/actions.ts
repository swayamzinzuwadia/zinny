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
import { createCode, createCombo, createListing, setCodeStatus, setListingStatus, updateListing } from "./listings";
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
      return `Code applied. You pay ${inr(q.totalPaise)}, saving ${inr(q.savedPaise)}.`;
    });
  }
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/marketplace/${listingId}`)}`);
  let dest: string | null = null;
  const res = await attempt(async () => {
    const { slug, orderId } = await startPurchase(userId, listingId, code);
    dest = `/${slug}/learn/checkout/${orderId}`;
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

export async function updateListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    await updateListing(actor, str(data, "listingId"), fieldsOf(data));
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
