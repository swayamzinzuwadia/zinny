import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import type { UniversityLite } from "@/contracts/core";
import { loadActor } from "./actor";
import { currentUserId } from "./auth/session";
import { ADMIN_PANEL_ROLES } from "./authz/roles";
import { isActive } from "./authz/engine";

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

/** Signed-in person working inside one university. Redirects to sign-in if needed. */
export const spaceContext = cache(async (slug: string) => {
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=/${slug}`);
  const university = await universityBySlug(slug);
  if (!university) notFound();
  const actor = await loadActor(userId, university.id);
  const now = new Date();
  const active = actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id);
  return {
    actor,
    university,
    isAdminUser: active.some((a) => ADMIN_PANEL_ROLES.has(a.role)),
    isLearner: active.some((a) => ["student", "alumni", "parent", "individual_learner"].includes(a.role)),
    isParent: active.some((a) => a.role === "parent"),
  };
});

export const platformContext = cache(async () => {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/platform");
  return loadActor(userId, null);
});
