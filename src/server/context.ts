import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import type { UniversityLite } from "@/contracts/core";
import { loadActor } from "./actor";
import { currentSession, currentUserId } from "./auth/session";
import { isChangeRequest, readViewAs } from "./auth/view-as";
import { ADMIN_PANEL_ROLES } from "./authz/roles";
import { can, isActive, type Actor } from "./authz/engine";
import { ForbiddenError } from "./errors";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";

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
      gstEnabled: universities.gstEnabled,
    })
    .from(universities)
    .where(eq(universities.slug, slug));
  return u ?? null;
});

/** "active", "suspended" (set by the Zinny team panel) or "frozen" (a self sign-up's trial ended without a plan). */
export const universityStatus = cache(async (universityId: string): Promise<string | null> => {
  const [u] = await systemDb().select({ status: universities.status }).from(universities).where(eq(universities.id, universityId));
  return u?.status ?? null;
});

/** The pages a frozen university's admins can still open: choosing and paying for a plan, and their documents. */
export const CHOOSE_PLAN_ROUTE = "/[uni]/admin/choose-plan";

/**
 * The route being rendered (like "/[uni]/admin/choose-plan"), for layouts, which aren't told
 * which page is under them. Null when Next doesn't say.
 */
function currentRoute(): string | null {
  try {
    return workAsyncStorage.getStore()?.route ?? null;
  } catch {
    return null;
  }
}

/**
 * Where a frozen university sends someone, or null to let them in. Nothing is deleted while
 * it is frozen: people who run the institute (settings.manage) go to choose a plan, and can
 * open only those pages; everyone else sees "temporarily unavailable". The Zinny team gets in
 * (support mode, viewing as someone, signed in as someone). When the route is unknown the
 * admin is let in rather than sent round in a loop.
 */
export function frozenRedirect(o: { slug: string; route: string | null; canChoosePlan: boolean; zinnyTeam: boolean }): string | null {
  if (o.zinnyTeam) return null;
  if (!o.canChoosePlan) return `/frozen?uni=${encodeURIComponent(o.slug)}`;
  if (o.route === null || o.route === CHOOSE_PLAN_ROUTE || o.route.startsWith(`${CHOOSE_PLAN_ROUTE}/`)) return null;
  return `/${o.slug}/admin/choose-plan`;
}

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
  // An address that isn't an institute is "not found" even when signed out, rather than a sign-in page.
  const university = await universityBySlug(slug);
  if (!university) notFound();
  // A phone-code session counts only in the institute it was made at: anywhere else this
  // person signs in again (with their password, or a code at this institute).
  const session = await currentSession();
  if (!session || (session.scopeUniversityId && session.scopeUniversityId !== university.id)) redirect(`/login?next=/${slug}`);
  const userId = session.userId;
  const signedIn = await loadActor(userId, university.id);
  const viewed = await viewedLearner(signedIn, university.id);
  // Nothing can be changed while viewing as someone: this stops every action, whatever it writes to.
  if (viewed && (await isChangeRequest())) throw new ForbiddenError(`You're viewing as ${viewed.name}, so nothing can be changed.`);
  const actor = viewed ?? signedIn;
  // A suspended university is closed to its own people; the Zinny team still gets in through
  // support mode, by viewing as a learner, or signed in as one of its people.
  const zinnyTeam = !!signedIn.supportSessionId || !!viewed || !!signedIn.impersonatedBy;
  const status = await universityStatus(university.id);
  if (!zinnyTeam && status === "suspended") redirect(`/suspended?uni=${encodeURIComponent(slug)}`);
  if (status === "frozen") {
    const to = frozenRedirect({ slug, route: currentRoute(), canChoosePlan: can(signedIn, "settings.manage", { universityId: university.id }), zinnyTeam });
    if (to) redirect(to);
  }
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
