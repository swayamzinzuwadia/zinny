"use server";

/**
 * Server actions for the data console (/platform/data). Each one reads the form and calls
 * data-console.ts, which checks that the person is a Super Admin, checks every name
 * against the database catalogue and logs every change.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { platformContext } from "@/server/context";
import { deleteRows, describeTable, insertRow, updateRow, type TableMeta } from "./data-console";
import { dataRowHref, dataTableHref } from "./lib/data-links";

/**
 * The values typed into a row form. Fields are `v.<column>`; a ticked `null.<column>` means
 * null; a checkbox column sends `bool.<column>` so an unticked box still counts as false.
 * On a new row an empty field is left out, so the database fills it in.
 */
function valuesFrom(t: TableMeta, data: FormData, mode: "insert" | "update"): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const names = new Set<string>();
  for (const k of data.keys()) {
    const m = /^(v|null|bool)\.(.+)$/.exec(k);
    if (m) names.add(m[2]);
  }
  for (const name of names) {
    // Unknown names go through as they are: the service refuses them by name.
    const col = t.columns.find((c) => c.name === name);
    if (data.get(`null.${name}`) === "on") {
      out[name] = null;
      continue;
    }
    if (data.has(`bool.${name}`) || col?.kind === "boolean") {
      out[name] = data.get(`v.${name}`) === "on" || data.get(`v.${name}`) === "true" ? "true" : "false";
      continue;
    }
    const raw = data.get(`v.${name}`);
    if (raw === null) continue;
    const v = String(raw);
    if (mode === "insert" && v.trim() === "") continue;
    out[name] = v;
  }
  return out;
}

export async function addRowAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const table = str(data, "table");
  let key: string[] | null = null;
  const res = await attempt(async () => {
    const t = await describeTable(actor, table);
    key = await insertRow(actor, t.name, valuesFrom(t, data, "insert"));
  });
  if (key) {
    revalidatePath("/platform", "layout");
    redirect(`${dataRowHref(table, key)}&added=1`);
  }
  return res;
}

export async function saveRowAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const table = str(data, "table");
  return attempt(async () => {
    const t = await describeTable(actor, table);
    const changed = await updateRow(actor, t.name, str(data, "key"), valuesFrom(t, data, "update"));
    revalidatePath("/platform", "layout");
    if (!changed.length) return "Nothing changed, so nothing was saved.";
    return `Saved. Changed ${changed.join(", ")}.`;
  });
}

export async function deleteRowAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const table = str(data, "table");
  let done = false;
  const res = await attempt(async () => {
    await deleteRows(actor, table, [str(data, "key")], str(data, "confirm"));
    done = true;
  });
  if (done) {
    revalidatePath("/platform", "layout");
    redirect(dataTableHref(table, { deleted: "1" }));
  }
  return res;
}

export async function deleteSelectedAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const table = str(data, "table");
  return attempt(async () => {
    const n = await deleteRows(
      actor,
      table,
      data.getAll("key").map(String),
      str(data, "confirm"),
    );
    revalidatePath("/platform", "layout");
    return `Deleted ${n.toLocaleString("en-IN")} ${n === 1 ? "row" : "rows"}.`;
  });
}
