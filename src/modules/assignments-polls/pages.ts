/** Helpers for this module's pages. */
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";

/** Shows the 404 page when a record is missing or out of reach, instead of an error. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);
