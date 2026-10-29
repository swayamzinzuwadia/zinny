/**
 * "My profile page": public profiles for teaching staff (photo, headline, bio, subjects and
 * the courses they teach). A faculty member edits only their own profile and sends it for
 * approval; an admin with `website.manage` approves it (it goes live) or sends it back with
 * a note. While changes wait, the last approved version stays live.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses } from "@/db/schema";
import { audit, notify, peopleLite, withTenant, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertManage, assertOwnProfile, coursesTaughtBy, isTeachingStaff, teachingStaffIds, uniOf, websiteManagerIds } from "./access";
import { assertMediaOf } from "./media";
import { siteFacultyProfiles, type FacultyProfileContent } from "./schema";
import { isUuid, optionalText, requireText } from "./validate";

export type ProfileStatus = "draft" | "pending" | "approved" | "changes_requested";
export const PROFILE_STATUS_LABEL: Record<ProfileStatus, string> = {
  draft: "Not sent yet",
  pending: "Waiting for approval",
  approved: "Approved",
  changes_requested: "Sent back",
};

export type FacultyProfileInput = { headline?: string; bio?: string; subjects?: string | string[]; photoMediaId?: string | null };

const EMPTY: FacultyProfileContent = { headline: "", bio: "", subjects: [], photoMediaId: null };

function cleanSubjects(v: FacultyProfileInput["subjects"]): string[] {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(/[,\n]/)).map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  const out: string[] = [];
  for (const s of list) {
    if (s.length > 40) throw new ValidationError(`"${s.slice(0, 40)}…" is too long for a subject. Keep each one under 40 characters.`);
    if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > 12) throw new ValidationError("List up to 12 subjects.");
  return out;
}

function cleanContent(input: FacultyProfileInput, current: FacultyProfileContent, submit: boolean): FacultyProfileContent {
  const content: FacultyProfileContent = {
    headline: submit ? requireText(input.headline, "Your headline", { min: 2, max: 120 }) : optionalText(input.headline, "Your headline", 120),
    bio: submit ? requireText(input.bio, "Your bio", { min: 40, max: 2000 }) : optionalText(input.bio, "Your bio", 2000),
    subjects: cleanSubjects(input.subjects),
    photoMediaId: input.photoMediaId === undefined ? current.photoMediaId : input.photoMediaId || null,
  };
  return content;
}

const same = (a: FacultyProfileContent | null, b: FacultyProfileContent | null) => JSON.stringify(a) === JSON.stringify(b);

async function courseTitles(tx: Tx, universityId: string, userIds: string[]) {
  const taught = await coursesTaughtBy(tx, universityId, userIds);
  const ids = [...new Set([...taught.values()].flat())];
  const rows = ids.length ? await tx.select({ id: courses.id, title: courses.title }).from(courses).where(inArray(courses.id, ids)) : [];
  const titleOf = new Map(rows.map((r) => [r.id, r.title]));
  return new Map([...taught].map(([u, cs]) => [u, cs.map((id) => ({ id, title: titleOf.get(id) ?? "" })).filter((c) => c.title)]));
}

/** The signed-in person's own profile page, or `eligible: false` if they don't teach. */
export async function getMyProfile(actor: Actor) {
  const universityId = uniOf(actor);
  if (!isTeachingStaff(actor)) return { eligible: false as const };
  assertOwnProfile(actor, actor.userId);
  return withTenant(actor, async (tx) => {
    const [row] = await tx.select().from(siteFacultyProfiles).where(eq(siteFacultyProfiles.userId, actor.userId));
    const taught = await courseTitles(tx, universityId, [actor.userId]);
    return { eligible: true as const, profile: row ?? null, courses: taught.get(actor.userId) ?? [] };
  });
}

/**
 * Save your own profile. `submit: true` sends it for approval (and needs a headline and a bio);
 * otherwise it is kept as a draft. Only ever your own: `userId` must be you.
 */
export async function saveFacultyProfile(actor: Actor, userId: string, input: FacultyProfileInput, opts: { submit: boolean }) {
  const universityId = assertOwnProfile(actor, userId);
  return withTenant(actor, async (tx) => {
    const [row] = await tx.select().from(siteFacultyProfiles).where(eq(siteFacultyProfiles.userId, userId)).for("update");
    const content = cleanContent(input, row?.draft ?? EMPTY, opts.submit);
    if (content.photoMediaId) await assertMediaOf(tx, content.photoMediaId);
    const unchangedFromLive = !!row?.published && same(content, row.published);
    const status: ProfileStatus = opts.submit ? (unchangedFromLive && row?.status === "approved" ? "approved" : "pending") : unchangedFromLive ? "approved" : "draft";
    const values = {
      draft: content,
      status,
      submittedAt: opts.submit ? new Date() : (row?.submittedAt ?? null),
      reviewNote: opts.submit ? "" : (row?.reviewNote ?? ""),
      updatedAt: new Date(),
    };
    const [saved] = row
      ? await tx.update(siteFacultyProfiles).set(values).where(eq(siteFacultyProfiles.id, row.id)).returning()
      : await tx.insert(siteFacultyProfiles).values({ universityId, userId, ...values }).returning();
    await audit(tx, actor, opts.submit ? "site.submit_faculty_profile" : "site.save_faculty_profile", "site_faculty_profile", saved.id, { status });
    if (opts.submit && status === "pending" && row?.status !== "pending") {
      await notify(tx, universityId, (await websiteManagerIds(tx, universityId)).filter((id) => id !== userId), {
        kind: "website.profile_submitted",
        title: `${actor.name} sent their public profile for approval`,
        body: content.headline,
        data: { profileId: saved.id },
      });
    }
    return saved;
  });
}

export type ProfileListFilter = ProfileStatus | "all";

export async function listFacultyProfiles(actor: Actor, filter: ProfileListFilter = "pending") {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(siteFacultyProfiles)
      .where(filter === "all" ? undefined : eq(siteFacultyProfiles.status, filter))
      .orderBy(asc(siteFacultyProfiles.submittedAt), asc(siteFacultyProfiles.updatedAt));
    const people = await peopleLite(tx, rows.map((r) => r.userId));
    const personOf = new Map(people.map((p) => [p.id, p]));
    const taught = await courseTitles(tx, universityId, rows.map((r) => r.userId));
    const counts = await tx.select({ status: siteFacultyProfiles.status, n: sql<number>`count(*)::int` }).from(siteFacultyProfiles).groupBy(siteFacultyProfiles.status);
    const withProfile = new Set((await tx.select({ userId: siteFacultyProfiles.userId }).from(siteFacultyProfiles)).map((r) => r.userId));
    const teaching = await teachingStaffIds(tx, universityId);
    const missing = await peopleLite(tx, teaching.filter((id) => !withProfile.has(id)));
    return {
      rows: rows.map((r) => ({
        ...r,
        name: personOf.get(r.userId)?.name ?? "Former staff",
        email: personOf.get(r.userId)?.email ?? "",
        courses: taught.get(r.userId) ?? [],
        /** The draft differs from what is live. */
        hasChanges: !same(r.draft, r.published),
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<ProfileStatus, number>>,
      withoutProfile: missing.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

async function loadProfile(tx: Tx, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Profile");
  const [row] = await tx.select().from(siteFacultyProfiles).where(eq(siteFacultyProfiles.id, id)).for("update");
  if (!row) throw new NotFoundError("Profile");
  return row;
}

/** Publish what the faculty member sent. */
export async function approveFacultyProfile(actor: Actor, id: string) {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const row = await loadProfile(tx, id);
    if (row.status !== "pending") throw new ConflictError("Only profiles waiting for approval can be approved. Reload the page to see the latest.");
    const [saved] = await tx
      .update(siteFacultyProfiles)
      .set({ published: row.draft, status: "approved", reviewNote: "", reviewedAt: new Date(), reviewedBy: actor.userId || null, updatedAt: new Date() })
      .where(eq(siteFacultyProfiles.id, id))
      .returning();
    await notify(tx, universityId, [row.userId], {
      kind: "website.profile_approved",
      title: "Your public profile is live",
      body: row.visible ? "It now appears on the university website." : "An admin has hidden it from the website for now.",
      data: { profileId: id },
    });
    await audit(tx, actor, "site.approve_faculty_profile", "site_faculty_profile", id, { userId: row.userId });
    return saved;
  });
}

/** Return the profile to its author with a note saying what to change. */
export async function sendBackFacultyProfile(actor: Actor, id: string, note: string) {
  const universityId = assertManage(actor);
  const text = requireText(note, "The note", { min: 5, max: 600 });
  return withTenant(actor, async (tx) => {
    const row = await loadProfile(tx, id);
    if (row.status !== "pending") throw new ConflictError("Only profiles waiting for approval can be sent back. Reload the page to see the latest.");
    const [saved] = await tx
      .update(siteFacultyProfiles)
      .set({ status: "changes_requested", reviewNote: text, reviewedAt: new Date(), reviewedBy: actor.userId || null, updatedAt: new Date() })
      .where(eq(siteFacultyProfiles.id, id))
      .returning();
    await notify(tx, universityId, [row.userId], {
      kind: "website.profile_sent_back",
      title: "Your public profile needs a few changes",
      body: text,
      data: { profileId: id },
    });
    await audit(tx, actor, "site.send_back_faculty_profile", "site_faculty_profile", id, { userId: row.userId });
    return saved;
  });
}

/** Take an approved profile off the website (or put it back). */
export async function setFacultyProfileVisible(actor: Actor, id: string, visible: boolean) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const row = await loadProfile(tx, id);
    const [saved] = await tx.update(siteFacultyProfiles).set({ visible, updatedAt: new Date() }).where(eq(siteFacultyProfiles.id, row.id)).returning();
    await audit(tx, actor, visible ? "site.show_faculty_profile" : "site.hide_faculty_profile", "site_faculty_profile", id, { userId: row.userId });
    return saved;
  });
}
