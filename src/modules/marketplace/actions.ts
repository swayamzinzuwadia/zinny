"use server";

/** Server actions for the marketplace. They only call services; the services check every permission. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, rupeesToPaise, str } from "@/server/action";
import { currentUserId } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { createListing, setListingStatus, updateListing } from "./listings";
import { startPurchase } from "./service";

/** "Buy": holds the purchase and opens checkout at the selling institute. */
export async function buyAction(_: ActionState, data: FormData): Promise<ActionState> {
  const listingId = str(data, "listingId");
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/marketplace/${listingId}`)}`);
  let dest: string | null = null;
  const res = await attempt(async () => {
    const { slug, orderId } = await startPurchase(userId, listingId);
    dest = `/${slug}/learn/checkout/${orderId}`;
  });
  if (dest) redirect(dest);
  return res;
}

const fieldsOf = (data: FormData) => ({
  title: str(data, "title"),
  description: str(data, "description"),
  pricePaise: rupeesToPaise(str(data, "price")),
});

export async function createListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const [kind, sourceId] = str(data, "source").split(":");
    if ((kind !== "course" && kind !== "lecture") || !sourceId) throw new ValidationError("Choose a course or lecture to sell.");
    await createListing(actor, { kind, sourceId, ...fieldsOf(data) });
    revalidatePath(`/${uni}/admin/products/marketplace`);
    revalidatePath("/marketplace");
    revalidatePath(`/site/${uni}`);
    return "Listed. It's on the marketplace now.";
  });
}

export async function updateListingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    await updateListing(actor, str(data, "listingId"), fieldsOf(data));
    revalidatePath(`/${uni}/admin/products/marketplace`);
    revalidatePath("/marketplace");
    revalidatePath(`/site/${uni}`);
    return "Listing saved. New buyers see these details and this price.";
  });
}

export async function setListingStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const status = str(data, "status") === "live" ? "live" : "paused";
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    await setListingStatus(actor, str(data, "listingId"), status);
    revalidatePath(`/${uni}/admin/products/marketplace`);
    revalidatePath("/marketplace");
    revalidatePath(`/site/${uni}`);
    return status === "live" ? "Back on the marketplace." : "Taken off the marketplace. People who bought it keep their access.";
  });
}
