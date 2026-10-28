import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { AppError } from "./errors";

/** Runs a server action and turns known errors into a message for the form. */
export async function attempt(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    return { ok: ok ?? "Saved.", at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { error: e.message, at: Date.now() };
    console.error(e);
    return { error: "Something went wrong. Please try again.", at: Date.now() };
  }
}

export const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();
export const num = (d: FormData, k: string) => Number(str(d, k));
export const rupeesToPaise = (v: string) => Math.round(Number(v.replace(/[,₹\s]/g, "") || "0") * 100);
