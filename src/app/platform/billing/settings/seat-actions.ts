"use server";
/** Seat pack defaults (billing settings) and a plan's own packs. Both need platform.seat_pricing. */
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { platformContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { parseRupees } from "@/modules/zinny-team-panel/lib/format";
import { saveSeatPackSettings } from "@/modules/zinny-team-panel/services/billing-settings";
import { savePlanPacks } from "@/modules/zinny-team-panel/services/plans";

const size = (data: FormData, key: string) => {
  const v = str(data, key).replace(/[,\s]/g, "");
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
};
const price = (data: FormData, key: string, who: string) => {
  const paise = parseRupees(str(data, key));
  if (!Number.isFinite(paise)) throw new ValidationError(`Enter the year price of a ${who} pack before GST in rupees, like 2500.`);
  return paise;
};
/** Empty means "use the default". */
const optional = <T,>(data: FormData, key: string, read: () => T): T | null => (str(data, key) === "" ? null : read());

export async function saveSeatPackSettingsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    await saveSeatPackSettings(actor, {
      studentPackSize: size(data, "studentPackSize"),
      studentPackPricePaise: price(data, "studentPackPrice", "student"),
      staffPackSize: size(data, "staffPackSize"),
      staffPackPricePaise: price(data, "staffPackPrice", "staff"),
    });
    revalidatePath("/platform", "layout");
    return "Seat packs saved. New packs and renewals use them; invoices already raised don't change.";
  });
}

export async function savePlanPacksAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  return attempt(async () => {
    const p = await savePlanPacks(actor, str(data, "planId"), {
      studentPackSize: optional(data, "studentPackSize", () => size(data, "studentPackSize")),
      studentPackPricePaise: optional(data, "studentPackPrice", () => price(data, "studentPackPrice", "student")),
      staffPackSize: optional(data, "staffPackSize", () => size(data, "staffPackSize")),
      staffPackPricePaise: optional(data, "staffPackPrice", () => price(data, "staffPackPrice", "staff")),
    });
    revalidatePath("/platform", "layout");
    return `Seat packs on ${p.name} saved. Empty fields use the defaults in billing settings.`;
  });
}
