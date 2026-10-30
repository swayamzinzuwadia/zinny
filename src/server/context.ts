import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import type { UniversityLite } from "@/contracts/core";
import { loadActor } from "./actor";
import { currentUserId } from "./auth/session";
import { isChangeRequest, readViewAs } from "./auth/view-as";
import { ADMIN_PANEL_ROLES } from "./authz/roles";
import { isActive, type Actor } from "./authz/engine";
import { ForbiddenError } from "./errors";

/** The university for a URL slug, shaped as UniversityLite (what slot components receive). */
export const universityBySlug = cache(async (slug: string): Promise<UniversityLite | null> => {
  const [u] = await systemDb()
    .select({
      id: universities.id,
      slug: universities.slug,
      name: universities.name,
      branding: universities.branding,
      timezone: universities.timezone,
      legalName: universities.legalName,
      gstin: universities.gstin,
    })
    .from(universities)
    .where(eq(universities.slug, slug));
  return u ?? null;
});

/** "active" or "suspended" (set by the Zinny team panel). */
export const universityStatus = cache(async (universityId: string): Promise<string | null> => {
  const [u] = await systemDb().select({ status: universities.status }).from(universities).where(eq(universities.id, universityId));
  return u?.status ?? null;
});

/** The person a Super Admin is viewing as at this university, as an actor. Checked on every request. */
async function viewedLearner(signedIn: Actor, universityId: string): Promise<Actor | null> {
  const target = await readViewAs();
  if (!target || target.universityId !== universityId) return null;
  const now = new Date();
  const superAdmin = signedIn.assignments.some((a) => a.scopeType === "platform" && a.role === "super_admin" && isActive(a, now));
  if (!superAdmin) return null;
  const person = await loadActor(target.userId, universityId).catch(() => null);
  return person && { ...person, supportSessionId: null, viewedBy: { userId: signedIn.userId, name: signedIn.name } };
}

/** Signed-in person working inside one university. Redirects to sign-in if needed. */
export const spaceContext = cache(async (slug: string) => {
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=/${slug}`);
  const university = await universityBySlug(slug);
  if (!university) notFound();
  const signedIn = await loadActor(userId, university.id);
  const viewed = await viewedLearner(signedIn, university.id);
  // Nothing can be changed while viewing as someone: this stops every action, whatever it writes to.
  if (viewed && (await isChangeRequest())) throw new ForbiddenError(`You're viewing as ${viewed.name}, so nothing can be changed.`);
  const actor = viewed ?? signedIn;
  // A suspended university is closed to its own people; the Zinny team still gets in through support mode.
  if (!signedIn.supportSessionId && !viewed && (await universityStatus(university.id)) === "suspended") redirect(`/suspended?uni=${encodeURIComponent(slug)}`);
  const now = new Date();
  const active = actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id);
  return {
    actor,
    university,
    isAdminUser: !viewed && active.some((a) => ADMIN_PANEL_ROLES.has(a.role)),
    isLearner: active.some((a) => ["student", "alumni", "parent", "individual_learner"].includes(a.role)),
    isParent: active.some((a) => a.role === "parent"),
  };
});

export const platformContext = cache(async () => {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/platform");
  return loadActor(userId, null);
});
