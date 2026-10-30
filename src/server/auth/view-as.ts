import "server-only";
/**
 * "View as student": which learner a Super Admin is looking through, held in a short-lived
 * cookie. The cookie grants nothing: spaceContext checks on every request that the person
 * holding it is a Super Admin. Everything done while viewing is read only (see withTenant).
 */
import { cookies, headers } from "next/headers";
import { cookieOptions } from "./session";

const COOKIE = "zinny_view_as";
const MINUTES = 30;

export type ViewAsTarget = { universityId: string; userId: string };

export async function readViewAs(): Promise<ViewAsTarget | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  const [universityId, userId] = (value ?? "").split(":");
  return universityId && userId ? { universityId, userId } : null;
}

export async function writeViewAs(target: ViewAsTarget) {
  (await cookies()).set(COOKIE, `${target.universityId}:${target.userId}`, cookieOptions(new Date(Date.now() + MINUTES * 60_000)));
}

export async function clearViewAs() {
  (await cookies()).delete(COOKIE);
}

/** True for a server action, which is how every change in the app is made. */
export async function isChangeRequest(): Promise<boolean> {
  const h = await headers();
  return h.has("next-action") || (h.get("content-type") ?? "").startsWith("multipart/form-data");
}
