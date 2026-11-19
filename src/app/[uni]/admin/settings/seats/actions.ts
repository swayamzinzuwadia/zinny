"use server";
/** The institute buys seat packs and pays its Zinny invoices. */
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { formatDate, formatINR } from "@/modules/zinny-team-panel/lib/format";
import { describePacks, isPackKind } from "@/modules/zinny-team-panel/lib/seat-packs";
import { buySeatPacks, payZinnyInvoice } from "@/modules/zinny-team-panel/services/seat-packs";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { actor, path: `/${uni}/admin/settings/seats` };
}

export async function buyPacksAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const kind = str(data, "kind");
    if (!isPackKind(kind)) throw new ValidationError("Pick student packs or staff packs.");
    const raw = str(data, "packs").replace(/[,\s]/g, "");
    const expected = str(data, "expectedTotalPaise");
    const r = await buySeatPacks(actor, { kind, packs: /^\d+$/.test(raw) ? Number(raw) : Number.NaN, expectedTotalPaise: /^\d+$/.test(expected) ? Number(expected) : undefined });
    revalidatePath(path);
    const what = describePacks(kind, r.pack.packsBought, r.pack.packsBought * r.pack.seatsPerPack);
    return r.invoice
      ? `Added ${what}. You can add people straight away. Invoice ${r.invoice.number} for ${formatINR(r.invoice.totalPaise)} is due on ${formatDate(r.invoice.dueDate)}.`
      : `Added ${what}. You can add people straight away.`;
  });
}

export async function payInvoiceAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const inv = await payZinnyInvoice(actor, str(data, "invoiceId"));
    revalidatePath(path);
    return `Invoice ${inv.number} is paid. Thank you.`;
  });
}
