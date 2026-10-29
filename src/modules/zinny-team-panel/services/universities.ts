/**
 * Universities (platform.manage_universities): the list, creating one, editing its basics,
 * and suspending or reactivating it. University rows change only through the core API
 * (`createUniversity`, `updateUniversity`).
 */
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { courses, departments, enrolments, universities, users } from "@/db/schema";
import { assertPlatform, canPlatform, createUniversity, updateUniversity, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { platAlerts, platContentFlags, platLicences } from "../schema";
import { daysBetween, todayIST } from "../lib/format";
import { saveLicence, syncAlertsFor, validateLicence, type LicenceInput } from "./licences";
import type { PlatformAction } from "../lib/access";
import { db, EMAIL_RE, emptyUsage, isUuid, logAction, universityOrThrow, usageFor } from "./shared";

/**
 * Web addresses a university can't take, because the app already uses them at the top
 * level (zinny.app/<slug> would never reach the university).
 */
export const RESERVED_SLUGS = new Set([
  "platform", "login", "logout", "api", "invite", "reset", "verify", "site", "admin", "learn", "_next", "static",
  "public", "brand", "favicon.ico", "robots.txt", "sitemap.xml", "help", "support", "www", "app", "zinny",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function checkSlug(raw: string) {
  const slug = raw.trim().toLowerCase();
  if (slug.length < 2 || !SLUG_RE.test(slug)) {
    throw new ValidationError("The web address can use a to z, 0 to 9 and hyphens, 2 to 40 characters, and can't start or end with a hyphen.");
  }
  if (RESERVED_SLUGS.has(slug)) throw new ValidationError(`"${slug}" is reserved by Zinny. Pick another web address.`);
  return slug;
}

function suggestPrefix(slug: string) {
  return (slug.replace(/[^a-z0-9]/g, "").slice(0, 4) || "UNI").toUpperCase();
}

export type UniversityListRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  students: number;
  staff: number;
  plan: string | null;
  studentCap: number | null;
  staffCap: number | null;
  endDate: string | null;
  daysLeft: number | null;
  openAlerts: number;
};

/** Every university with its status, people, plan and renewal date. */
export async function listUniversities(actor: Actor, today = todayIST()): Promise<UniversityListRow[]> {
  assertPlatform(actor, "platform.manage_universities");
  const conn = db();
  const [unis, usage, lics, alerts] = await Promise.all([
    conn
      .select({ id: universities.id, name: universities.name, slug: universities.slug, status: universities.status, createdAt: universities.createdAt })
      .from(universities)
      .orderBy(asc(universities.name)),
    usageFor(conn),
    conn.select().from(platLicences),
    conn
      .select({ universityId: platAlerts.universityId, n: count() })
      .from(platAlerts)
      .where(isNull(platAlerts.resolvedAt))
      .groupBy(platAlerts.universityId),
  ]);
  const licOf = new Map(lics.map((l) => [l.universityId, l]));
  const alertsOf = new Map(alerts.map((a) => [a.universityId, a.n]));
  return unis.map((u) => {
    const l = licOf.get(u.id);
    const use = usage.get(u.id) ?? emptyUsage();
    return {
      ...u,
      ...use,
      plan: l?.plan ?? null,
      studentCap: l?.studentCap ?? null,
      staffCap: l?.staffCap ?? null,
      endDate: l?.endDate ?? null,
      daysLeft: l ? daysBetween(today, l.endDate) : null,
      openAlerts: alertsOf.get(u.id) ?? 0,
    };
  });
}

/** One university: its basics, people, licence, activity and open content flags. */
export async function getUniversity(actor: Actor, universityId: string, today = todayIST()) {
  assertPlatform(actor, "platform.manage_universities");
  if (!isUuid(universityId)) throw new NotFoundError("University");
  const conn = db();
  const university = await universityOrThrow(conn, universityId);
  const [[licence], usage, [counts], flags, alerts, [admin]] = await Promise.all([
    conn.select().from(platLicences).where(eq(platLicences.universityId, universityId)),
    usageFor(conn, [universityId]),
    conn
      .select({
        departments: sql<number>`(select count(*) from ${departments} where ${departments.universityId} = ${universityId})`.mapWith(Number),
        courses: sql<number>`(select count(*) from ${courses} where ${courses.universityId} = ${universityId})`.mapWith(Number),
        published: sql<number>`(select count(*) from ${courses} where ${courses.universityId} = ${universityId} and ${courses.status} = 'published')`.mapWith(Number),
        activeEnrolments: sql<number>`(select count(*) from ${enrolments} where ${enrolments.universityId} = ${universityId} and ${enrolments.status} = 'active')`.mapWith(Number),
      })
      .from(universities)
      .where(eq(universities.id, universityId)),
    conn
      .select({ id: platContentFlags.id, courseId: platContentFlags.courseId, courseTitle: courses.title, category: platContentFlags.category, note: platContentFlags.note, createdAt: platContentFlags.createdAt })
      .from(platContentFlags)
      .innerJoin(courses, eq(courses.id, platContentFlags.courseId))
      .where(and(eq(platContentFlags.universityId, universityId), eq(platContentFlags.status, "open"))),
    conn.select().from(platAlerts).where(and(eq(platAlerts.universityId, universityId), isNull(platAlerts.resolvedAt))),
    conn.execute<{ name: string; email: string; invited: boolean }>(sql`
      select u.name, u.email, (u.password_hash is null) as invited
      from role_assignments ra join ${users} u on u.id = ra.user_id
      where ra.university_id = ${universityId} and ra.role = 'institute_admin' and ra.revoked_at is null
      order by ra.created_at asc limit 1`),
  ]);
  return {
    university,
    licence: licence ?? null,
    daysLeft: licence ? daysBetween(today, licence.endDate) : null,
    usage: usage.get(universityId) ?? emptyUsage(),
    counts,
    flags,
    alerts,
    admin: (admin as { name: string; email: string; invited: boolean } | undefined) ?? null,
  };
}

export type NewUniversityInput = {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  invoicePrefix?: string;
  /** Set up the licence at the same time (needs platform.licences). */
  licence?: LicenceInput | null;
};

/**
 * Creates a university through core `createUniversity`, which gives its admin the
 * Institute Admin role and invites them (`user.invited`). With a licence and the
 * platform.licences permission, the licence is saved straight after.
 */
export async function createUniversityWithLicence(actor: Actor, input: NewUniversityInput) {
  assertPlatform(actor, "platform.manage_universities");
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Enter the university's name.");
  if (name.length > 120) throw new ValidationError("Keep the name under 120 characters.");
  const slug = checkSlug(input.slug);
  const adminName = input.adminName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (adminName.length < 2) throw new ValidationError("Enter the Institute Admin's name.");
  if (!EMAIL_RE.test(adminEmail)) throw new ValidationError("Enter a valid email for the Institute Admin.");
  const prefix = (input.invoicePrefix?.trim() || suggestPrefix(slug)).toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(prefix)) throw new ValidationError("Invoice prefix is 1 to 4 letters or numbers, like NMIM.");
  const withLicence = !!input.licence && canPlatform(actor, "platform.licences");
  // Check the licence before anything is created, so a mistake there doesn't leave a half-made university.
  if (withLicence) validateLicence(input.licence!);

  const [taken] = await db().select({ id: universities.id }).from(universities).where(eq(universities.slug, slug));
  if (taken) throw new ConflictError("Another university already uses that web address.");

  const uni = await createUniversity(actor, { name, slug, adminName, adminEmail, invoicePrefix: prefix });
  if (withLicence) await saveLicence(actor, uni.id, input.licence!);
  return uni;
}

export type BasicsInput = {
  name: string;
  slug: string;
  timezone: string;
  gstin: string;
  legalName: string;
  address: string;
  stateCode: string;
  invoicePrefix: string;
};

/** Edits name, web address, time zone, GSTIN, legal name, address, state and invoice prefix (core `updateUniversity`). */
export async function updateBasics(actor: Actor, universityId: string, input: BasicsInput) {
  assertPlatform(actor, "platform.manage_universities");
  if (!isUuid(universityId)) throw new NotFoundError("University");
  const before = await universityOrThrow(db(), universityId);
  const slug = input.slug.trim().toLowerCase() === before.slug ? before.slug : checkSlug(input.slug);
  if (slug !== before.slug) {
    const [taken] = await db().select({ id: universities.id }).from(universities).where(eq(universities.slug, slug));
    if (taken) throw new ConflictError("Another university already uses that web address.");
  }
  if (input.legalName.trim().length > 200) throw new ValidationError("Keep the legal name under 200 characters.");
  if (input.address.trim().length > 500) throw new ValidationError("Keep the address under 500 characters.");
  return updateUniversity(actor, universityId, {
    name: input.name,
    slug,
    timezone: input.timezone.trim(),
    gstin: input.gstin,
    legalName: input.legalName,
    address: input.address,
    stateCode: input.stateCode.trim(),
    invoicePrefix: input.invoicePrefix,
  });
}

/**
 * Suspends or reactivates a university (core `updateUniversity`). Suspending needs a
 * reason, which goes into the university's audit log with who did it.
 */
export async function setUniversityStatus(actor: Actor, universityId: string, status: "active" | "suspended", reason: string) {
  assertPlatform(actor, "platform.manage_universities");
  if (status !== "active" && status !== "suspended") throw new ValidationError("Status is active or suspended.");
  if (!isUuid(universityId)) throw new NotFoundError("University");
  const why = reason.trim();
  if (status === "suspended" && why.length < 5) throw new ValidationError("Write why you are suspending this university.");
  const before = await universityOrThrow(db(), universityId);
  if (before.status === status) {
    throw new ConflictError(status === "suspended" ? "This university is already suspended." : "This university is already active.");
  }
  const after = await updateUniversity(actor, universityId, { status });
  await db().transaction(async (tx) => {
    await logAction(tx, actor, { universityId, inUniversityLog: true }, status === "suspended" ? "plat.university.suspend" : "plat.university.reactivate", "university", universityId, {
      reason: why || null,
    });
    // A suspended university has no licence warnings; a reactivated one gets them back.
    await syncAlertsFor(tx, actor, universityId, todayIST());
  });
  return after;
}

const PICKER_ACTIONS: PlatformAction[] = ["platform.manage_universities", "platform.support_mode", "platform.licences", "platform.finance", "platform.view_analytics"];

/** id, name and slug of every university, for pickers in the sections that work across universities. */
export async function universityOptions(actor: Actor) {
  if (!PICKER_ACTIONS.some((a) => canPlatform(actor, a))) assertPlatform(actor, "platform.manage_universities");
  return db()
    .select({ id: universities.id, name: universities.name, slug: universities.slug, status: universities.status })
    .from(universities)
    .orderBy(asc(universities.name));
}
