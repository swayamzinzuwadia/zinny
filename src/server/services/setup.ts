/**
 * "Get set up": the first things a new institute does, each marked done from real data.
 * One query of cheap EXISTS checks, under row-level security. Shown to people who run the
 * whole institute (settings.manage), on the admin dashboard, until everything is done.
 */
import { sql } from "drizzle-orm";
import { assertCan, can, type Actor } from "../authz/engine";
import { modules } from "../registry";
import { withTenant } from "../tenant";
import { loadCourse } from "./courses";

export type SetupKey = "course" | "batch" | "teacher" | "publish" | "students" | "website" | "marketplace";
export type SetupItem = { key: SetupKey; label: string; hint: string; done: boolean; href: string; action: string };
export type SetupChecklist = { items: SetupItem[]; done: number; total: number; next: SetupKey | null };

/** The cookie that remembers "Hide checklist" for one institute (per browser; no table needed). */
export const setupHiddenCookie = (universityId: string) => `zinny_setup_hidden_${universityId.replace(/-/g, "")}`;

/** Only people who manage the whole institute see the checklist. */
export function canSeeSetup(actor: Actor) {
  return !!actor.universityId && can(actor, "settings.manage", { universityId: actor.universityId });
}

type Facts = {
  courses: boolean;
  batches: boolean;
  teachers: boolean;
  published: boolean;
  students: boolean;
  website: boolean;
  listed: boolean;
  /** A draft course with an open batch, ready to publish. */
  draftId: string | null;
  /** A course with no batch yet. */
  batchlessId: string | null;
};

/**
 * The checklist for this institute, or null for someone who doesn't run it.
 * Website and marketplace are modules: their tables are read by name here (row-level
 * security still applies), and their items show only when the module is installed.
 */
export async function setupChecklist(actor: Actor, uni: string): Promise<SetupChecklist | null> {
  if (!canSeeSetup(actor)) return null;
  const installed = new Set(modules().map((m) => m.id));
  const hasWebsite = installed.has("website-builder");
  const hasMarketplace = installed.has("marketplace");

  const facts = await withTenant(actor, async (tx) => {
    const rows = await tx.execute<Facts>(sql`
      select
        exists(select 1 from courses where status <> 'archived') as "courses",
        exists(select 1 from batches b where not b.recorded and exists(select 1 from batch_slots s where s.batch_id = b.id)) as "batches",
        exists(
          select 1 from role_assignments
          where role in ('hod', 'permanent_faculty', 'visiting_faculty') and revoked_at is null and (ends_at is null or ends_at > now())
        ) as "teachers",
        exists(select 1 from courses where status = 'published') as "published",
        exists(
          select 1 from role_assignments
          where role in ('student', 'alumni') and revoked_at is null
        ) as "students",
        ${hasWebsite ? sql`exists(select 1 from site_pages where published_at is not null)` : sql`false`} as "website",
        ${hasMarketplace ? sql`exists(select 1 from mkt_listings where status = 'live')` : sql`false`} as "listed",
        (
          select c.id from courses c
          where c.status = 'draft' and exists(select 1 from batches b where b.course_id = c.id and b.status = 'open' and not b.recorded)
          order by c.created_at limit 1
        ) as "draftId",
        (
          select c.id from courses c
          where c.status <> 'archived' and not exists(select 1 from batches b where b.course_id = c.id and not b.recorded)
          order by c.created_at limit 1
        ) as "batchlessId"
    `);
    return rows[0];
  });

  const base = `/${uni}/admin`;
  const newCourse = `${base}/products/courses/new`;
  const items: SetupItem[] = [
    {
      key: "course",
      label: "Create your first course",
      hint: "A title is enough. Department, batch and teacher can go on the same page.",
      done: facts.courses,
      href: newCourse,
      action: "Create a course",
    },
    {
      key: "batch",
      label: "Add a batch with timings",
      hint: "The days, times and seats students pick from.",
      done: facts.batches,
      href: facts.batchlessId ? `${base}/products/courses/${facts.batchlessId}?tab=batches` : newCourse,
      action: "Add a batch",
    },
    {
      key: "teacher",
      label: "Add a teacher",
      hint: "Someone on the teaching staff. If you teach, you can add yourself.",
      done: facts.teachers,
      href: facts.courses ? `${base}/users/teaching` : newCourse,
      action: "Add a teacher",
    },
    {
      key: "publish",
      label: "Publish a course",
      hint: "Students can see it and enrol.",
      done: facts.published,
      href: facts.draftId ? `${base}/products/courses/${facts.draftId}` : facts.courses ? `${base}/products/courses` : newCourse,
      action: facts.draftId ? "Open the course to publish" : "Open courses",
    },
    {
      key: "students",
      label: "Invite students",
      hint: "Add them by email, import a list, or share your joining code.",
      done: facts.students,
      href: `${base}/users/students`,
      action: "Invite students",
    },
    ...(hasWebsite
      ? [
          {
            key: "website" as const,
            label: "Set up your website",
            hint: "Your public page, with your courses on it.",
            done: facts.website,
            href: `${base}/website/sections`,
            action: "Set up website",
          },
        ]
      : []),
    ...(hasMarketplace
      ? [
          {
            key: "marketplace" as const,
            label: "List on the marketplace",
            hint: "Sell seats in a live batch, or a course's recordings, to learners across Zinny.",
            done: facts.listed,
            href: `${base}/marketplace`,
            action: "Open marketplace",
          },
        ]
      : []),
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, next: items.find((i) => !i.done)?.key ?? null };
}

export type NextStep = { key: "lessons" | "students" | "share" | "marketplace"; label: string; hint: string; href: string };

/**
 * "What's next" after a course is created: the steps not done yet, for someone who can
 * change the course. Lessons and listings are module tables, read by name (see above).
 */
export async function courseNextSteps(actor: Actor, uni: string, courseId: string, opts: { canInvite: boolean }): Promise<NextStep[]> {
  const installed = new Set(modules().map((m) => m.id));
  const hasLessons = installed.has("content-progress");
  const hasMarketplace = installed.has("marketplace");
  const facts = await withTenant(actor, async (tx) => {
    const { target } = await loadCourse(tx, actor.universityId!, courseId);
    assertCan(actor, "course.update", target);
    const rows = await tx.execute<{ lessons: boolean; students: boolean; enrolled: boolean; listed: boolean }>(sql`
      select
        ${hasLessons ? sql`exists(select 1 from content_lessons where course_id = ${courseId})` : sql`true`} as "lessons",
        exists(select 1 from role_assignments where role = 'student' and revoked_at is null) as "students",
        exists(select 1 from enrolments where course_id = ${courseId} and status in ('active', 'requested', 'approved', 'held')) as "enrolled",
        ${hasMarketplace ? sql`exists(select 1 from mkt_listings where course_id = ${courseId} and status <> 'removed')` : sql`true`} as "listed"
    `);
    return rows[0];
  });
  const base = `/${uni}/admin`;
  const course = `${base}/products/courses/${courseId}`;
  const steps: NextStep[] = [];
  if (!facts.lessons) steps.push({ key: "lessons", label: "Add lessons", hint: "Videos, notes and files students work through.", href: `${course}?tab=curriculum` });
  if (opts.canInvite && !facts.students) steps.push({ key: "students", label: "Invite students", hint: "Add them by email or import a list.", href: `${base}/users/students` });
  if (opts.canInvite && !facts.enrolled)
    steps.push({ key: "share", label: "Share your joining code", hint: "Students join the institute with it, then enrol in this course.", href: base });
  if (!facts.listed)
    steps.push({
      key: "marketplace",
      label: "Sell the recordings on the marketplace",
      hint: facts.lessons ? "List this course for learners across Zinny." : "Once it has a video lesson, list it for learners across Zinny.",
      href: `${course}?tab=marketplace`,
    });
  return steps;
}
