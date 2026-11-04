"use server";

import { unstable_rethrow } from "next/navigation";
import { str } from "@/server/action";
import { clientInfo } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import type { DemoRequestState } from "@/modules/marketing/components/DemoRequestForm";
import { requestDemo } from "@/modules/zinny-team-panel/services/demo-requests";

const FIELDS = ["name", "role", "institute", "city", "phone", "email", "message"] as const;

/** The "Book a demo" form: emails the Zinny team, or says what to fix and keeps what was typed. */
export async function requestDemoAction(_: DemoRequestState, data: FormData): Promise<DemoRequestState> {
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(data, k)]));
  try {
    const { ip } = await clientInfo();
    await requestDemo({ ...values, website: str(data, "website") }, { ip });
    return { ok: `Thank you. Someone from the Zinny team will get in touch at ${values.email} or ${values.phone} to find a time that suits you.`, at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { error: e.message, values, at: Date.now() };
    console.error(e);
    return { error: "Something went wrong on our side, so your request wasn't sent. Please try again.", values, at: Date.now() };
  }
}
