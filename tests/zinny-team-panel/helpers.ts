import type { RoleName } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { grant, makeUser } from "../fixtures";

/** A Zinny team member with the given platform roles, as they act on /platform. */
export async function team(name: string, ...roles: RoleName[]) {
  const u = await makeUser(name);
  for (const r of roles) await grant(u.id, r);
  return loadActor(u.id, null);
}

export const licence = (over: Partial<{ plan: string; studentCap: number; staffCap: number; modules: string[]; startDate: string; endDate: string }> = {}) => ({
  plan: "standard",
  studentCap: 100,
  staffCap: 10,
  modules: ["assessments", "live-classes"],
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  ...over,
});
