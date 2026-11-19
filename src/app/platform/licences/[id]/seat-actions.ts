"use server";
/** Seat packs and caps on a licence, from the Zinny team's licence page. */
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { platformContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { formatDate, formatINR, parseRupees } from "@/modules/zinny-team-panel/lib/format";
import { describePacks, isPackKind } from "@/modules/zinny-team-panel/lib/seat-packs";
import { addSeatPacks, removeSeatPacks, setUserCaps } from "@/modules/zinny-team-panel/services/seat-packs";

const whole = (data: FormData, key: string) => {
  const v = str(data, key).replace(/[,\s]/g, "");
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
};

const kindOf = (data: FormData) => {
  const kind = str(data, "kind");
  if (!isPackKind(kind)) throw new ValidationError("Pick student packs or staff packs.");
  return kind;
};

export async function addPacksAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const r = await addSeatPacks(actor, str(data, "universityId"), { kind: kindOf(data), packs: whole(data, "packs"), note: str(data, "note"), invoice: data.get("charge") === "on" });
    revalidatePath("/platform", "layout");
    const what = describePacks(r.pack.kind as "student" | "staff", r.pack.packsBought, r.pack.packsBought * r.pack.seatsPerPack);
    return r.invoice
      ? `Added ${what}. The cap is now ${r.capAfter.toLocaleString("en-IN")}. Invoice ${r.invoice.number} for ${formatINR(r.invoice.totalPaise)} is due on ${formatDate(r.invoice.dueDate)}.`
      : `Added ${what}. The cap is now ${r.capAfter.toLocaleString("en-IN")}. No invoice was created.`;
  });
}

export async function removePacksAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const kind = kindOf(data);
    const r = await removeSeatPacks(actor, str(data, "universityId"), { kind, packs: whole(data, "packs"), note: str(data, "note") });
    revalidatePath("/platform", "layout");
    return `Removed ${describePacks(kind, r.packs, r.seats)}. The cap is now ${r.capAfter.toLocaleString("en-IN")}. Invoices already raised are unchanged.`;
  });
}

export async function setCapsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const raw = str(data, "charge");
    const chargePaise = raw ? parseRupees(raw) : 0;
    if (!Number.isFinite(chargePaise)) throw new ValidationError("Enter the charge before GST in rupees, like 5000, or leave it empty.");
    const r = await setUserCaps(actor, str(data, "universityId"), { studentCap: whole(data, "studentCap"), staffCap: whole(data, "staffCap"), note: str(data, "note"), chargePaise });
    revalidatePath("/platform", "layout");
    return r.invoice
      ? `Caps saved. Invoice ${r.invoice.number} for ${formatINR(r.invoice.totalPaise)} is due on ${formatDate(r.invoice.dueDate)}.`
      : "Caps saved. No invoice was created.";
  });
}
