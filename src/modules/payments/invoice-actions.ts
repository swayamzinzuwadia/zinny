"use server";

/**
 * Server actions for Finance → Invoices, invoice categories and the GST setting. Each one
 * builds the actor from the session for the university in the URL and calls a service;
 * the services check every permission.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { archiveCategory, createCategory, restoreCategory, updateCategory } from "./categories";
import {
  cancelManualInvoice,
  createManualInvoice,
  markManualUnpaid,
  recordManualPayment,
  searchBillable,
  updateManualInvoice,
  type BillablePerson,
  type LineInput,
} from "./manual-invoices";
import { parseRupees } from "./money";
import { updateGstSetting } from "./settings";

const SLUG = /^[a-z0-9-]{2,40}$/;

async function ctx(uni: string) {
  if (!SLUG.test(uni)) throw new ValidationError("Unknown institute.");
  const { actor } = await spaceContext(uni);
  return actor;
}

const invoicesPath = (uni: string) => `/${uni}/admin/finance/invoices`;

/** Sales → Invoice settings: "Charge GST on fees". */
export async function saveGstSettingAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const enabled = str(data, "gstEnabled") === "on";
    const out = await updateGstSetting(await ctx(uni), enabled);
    revalidatePath(`/${uni}`, "layout");
    if (!out.changed) return enabled ? "GST is already on. Nothing changed." : "GST is already off. Nothing changed.";
    return enabled
      ? "GST is on. New orders and invoices add GST; earlier ones stay as they were."
      : "GST is off. New orders and invoices carry no GST; earlier ones stay as they were.";
  });
}

function categoryInput(data: FormData) {
  const rate = Number(str(data, "gstRate") || "18");
  return {
    name: str(data, "name"),
    description: str(data, "description"),
    defaultGstRateBp: Number.isFinite(rate) ? Math.round(rate * 100) : -1,
    sacCode: str(data, "sacCode") || null,
  };
}

export async function createCategoryAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const c = await createCategory(await ctx(uni), categoryInput(data));
    revalidatePath(invoicesPath(uni), "layout");
    return `${c.name} added. Pick it when you create an invoice.`;
  });
}

export async function updateCategoryAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const c = await updateCategory(await ctx(uni), str(data, "categoryId"), categoryInput(data));
    revalidatePath(invoicesPath(uni), "layout");
    return `${c.name} saved. Invoices already issued keep their own GST rate and SAC code.`;
  });
}

export async function archiveCategoryAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const c = await archiveCategory(await ctx(uni), str(data, "categoryId"));
    revalidatePath(invoicesPath(uni), "layout");
    return `${c.name} archived. It stays on its invoices but can't be picked for new ones.`;
  });
}

export async function restoreCategoryAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const c = await restoreCategory(await ctx(uni), str(data, "categoryId"));
    revalidatePath(invoicesPath(uni), "layout");
    return `${c.name} restored.`;
  });
}

/** Reads the repeated line fields of the invoice form. Empty rows are dropped by the service. */
function linesFrom(data: FormData): LineInput[] {
  const descriptions = data.getAll("lineDescription").map(String);
  const quantities = data.getAll("lineQuantity").map(String);
  const prices = data.getAll("linePrice").map(String);
  return descriptions.map((description, i) => {
    const priceText = (prices[i] ?? "").trim();
    const price = priceText ? parseRupees(priceText) : 0;
    if (price === null) throw new ValidationError(`Enter the price on line ${i + 1} in rupees, like 1500 or 1500.50.`);
    const qtyText = (quantities[i] ?? "").trim();
    return { description, quantity: qtyText ? Number(qtyText) : 1, unitPricePaise: price };
  });
}

function discountFrom(data: FormData) {
  const text = str(data, "discount");
  if (!text) return 0;
  const paise = parseRupees(text);
  if (paise === null) throw new ValidationError("Enter the discount in rupees, like 500. Leave it empty for no discount.");
  return paise;
}

/** Finance → Invoices → Create invoice. Opens the new invoice on success. */
export async function createInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  let id: string | null = null;
  const res = await attempt(async () => {
    const actor = await ctx(uni);
    const billTo = str(data, "billTo");
    const rate = str(data, "gstRate");
    if (billTo === "person" && !str(data, "userId")) {
      throw new ValidationError("Say who the invoice is for: search for a student and pick them, or choose “Someone else” and type the name.");
    }
    const inv = await createManualInvoice(actor, {
      categoryId: str(data, "categoryId") || null,
      userId: billTo === "person" ? str(data, "userId") : null,
      buyerName: str(data, "buyerName"),
      buyerEmail: str(data, "buyerEmail"),
      buyerPhone: str(data, "buyerPhone"),
      buyerAddress: String(data.get("buyerAddress") ?? ""),
      buyerGstin: str(data, "buyerGstin"),
      placeOfSupply: str(data, "placeOfSupply"),
      lines: linesFrom(data),
      discountPaise: discountFrom(data),
      discountNote: str(data, "discountNote"),
      gstRateBp: rate === "" ? undefined : Math.round(Number(rate) * 100),
      issueDate: str(data, "issueDate"),
      dueDate: str(data, "dueDate") || null,
      notes: String(data.get("notes") ?? ""),
    });
    id = inv.id;
    revalidatePath(invoicesPath(uni), "layout");
  });
  if (id) redirect(`${invoicesPath(uni)}/${id}?created=1`);
  return res;
}

/** Edits an unpaid invoice's dates, lines, discount and notes. */
export async function updateInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const invoiceId = str(data, "invoiceId");
  let done = false;
  const res = await attempt(async () => {
    await updateManualInvoice(await ctx(uni), invoiceId, {
      lines: linesFrom(data),
      discountPaise: discountFrom(data),
      discountNote: str(data, "discountNote"),
      issueDate: str(data, "issueDate"),
      dueDate: str(data, "dueDate") || null,
      notes: String(data.get("notes") ?? ""),
    });
    done = true;
    revalidatePath(invoicesPath(uni), "layout");
  });
  if (done) redirect(`${invoicesPath(uni)}/${invoiceId}?saved=1`);
  return res;
}

export async function recordPaymentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const inv = await recordManualPayment(await ctx(uni), str(data, "invoiceId"), { paidOn: str(data, "paidOn"), mode: str(data, "mode"), reference: str(data, "reference") });
    revalidatePath(invoicesPath(uni), "layout");
    return `Payment recorded. Invoice ${inv.number} is paid and locked.`;
  });
}

export async function markUnpaidAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const inv = await markManualUnpaid(await ctx(uni), str(data, "invoiceId"));
    revalidatePath(invoicesPath(uni), "layout");
    return `Invoice ${inv.number} is unpaid again and can be edited.`;
  });
}

export async function cancelInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  return attempt(async () => {
    const inv = await cancelManualInvoice(await ctx(uni), str(data, "invoiceId"), str(data, "reason"));
    revalidatePath(invoicesPath(uni), "layout");
    return `Invoice ${inv.number} is cancelled. It stays in the list with its number.`;
  });
}

/** "Bill to" search on the invoice form: people of this institute by name or email. */
export async function searchBillableAction(uni: string, q: string): Promise<BillablePerson[]> {
  try {
    return await searchBillable(await ctx(String(uni)), String(q));
  } catch (e) {
    unstable_rethrow(e);
    return [];
  }
}
