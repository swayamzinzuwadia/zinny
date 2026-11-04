import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadActor } from "@/server/actor";
import { currentUserId } from "@/server/auth/session";
import { hasRole } from "@/server/authz/engine";
import { getCourse, getSite } from "@/modules/website-builder/cached";
import { container } from "@/modules/website-builder/components/site/bits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enrol", robots: { index: false, follow: false } };

type Props = { params: Promise<{ uni: string; courseId: string }> };

/**
 * "Enrol" on a course page. Students go straight to the batch picker; someone signed out signs
 * in first and comes back to this course; someone signed in who isn't a student here is told how
 * to join, instead of being sent somewhere else without a word.
 */
export default async function Enrol({ params }: Props) {
  const { uni, courseId } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const course = await getCourse(uni, site.universityId, courseId);
  if (!course) notFound();
  const picker = `/${uni}/learn/courses/${course.id}`;

  const userId = await currentUserId();
  if (!userId) redirect(`/login?uni=${encodeURIComponent(uni)}&next=${encodeURIComponent(picker)}`);
  const actor = await loadActor(userId, site.universityId);
  if (hasRole(actor, ["student", "alumni"])) redirect(picker);

  const coursePage = `/site/${uni}/courses/${course.id}`;
  return (
    <div className={`${container} max-w-2xl py-16 sm:py-24`}>
      <Link href={coursePage} className="text-[14px] text-muted hover:text-ink">
        {course.title}
      </Link>
      <h1 className="mt-3 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[42px]">Join {site.name} to enrol</h1>
      <p className="mt-4 max-w-[54ch] text-[17px] leading-relaxed text-ink/80">
        Batches are for {site.name}&apos;s students. You&apos;re signed in as {actor.email}, which isn&apos;t a student account here yet. Enter the joining code the institute
        gave you, then come back to pick your batch.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/join" className="inline-flex h-12 items-center rounded-full bg-[var(--site-primary)] px-6 text-[15px] font-medium text-[var(--site-on-primary)] hover:opacity-90">
          Enter a joining code
        </Link>
        <Link href={`${coursePage}#course-enquiry`} className="inline-flex h-12 items-center rounded-full border border-[var(--site-line)] px-6 text-[15px] font-medium hover:bg-[var(--site-soft)]">
          Ask about this course
        </Link>
      </div>
    </div>
  );
}
