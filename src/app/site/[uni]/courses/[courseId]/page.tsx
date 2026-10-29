import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { submitEnquiryAction } from "@/modules/website-builder/actions";
import { getCourse, getHome, getSite } from "@/modules/website-builder/cached";
import { container, JsonLd, priceLine, SeatsLeft, Stars, startLine } from "@/modules/website-builder/components/site/bits";
import { EnquiryForm } from "@/modules/website-builder/components/site/forms";
import { formatDate, formatINR, truncate } from "@/modules/website-builder/format";

/** Seconds: seats change often, so course pages refresh every minute. */
export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ uni: string; courseId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uni, courseId } = await params;
  const site = await getSite(uni);
  const course = site ? await getCourse(uni, site.universityId, courseId) : null;
  if (!site || !course) return {};
  const description = course.description ? truncate(course.description, 160) : `${course.title} at ${site.name}: batches, timings and fees.`;
  return {
    title: course.title,
    description,
    alternates: { canonical: `/site/${uni}/courses/${course.id}` },
    openGraph: { title: `${course.title} | ${site.name}`, description, type: "website" },
  };
}

export default async function CoursePage({ params }: Props) {
  const { uni, courseId } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const course = await getCourse(uni, site.universityId, courseId);
  if (!course) notFound();
  const home = await getHome(uni, site.universityId);
  const total = course.pricePaise + Math.round((course.pricePaise * course.gstRateBp) / 10_000);
  const avg = course.reviews.length ? course.reviews.reduce((n, r) => n + r.rating, 0) / course.reviews.length : null;
  const anyOpen = course.batches.some((b) => b.seatsLeft > 0);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Course",
          name: course.title,
          description: course.description || course.title,
          provider: { "@type": "CollegeOrUniversity", name: site.name },
          ...(course.pricePaise > 0 && { offers: { "@type": "Offer", price: (total / 100).toFixed(2), priceCurrency: "INR", category: "Paid" } }),
          hasCourseInstance: course.batches.map((b) => ({ "@type": "CourseInstance", name: b.name, startDate: b.startDate, endDate: b.endDate, courseMode: "Blended" })),
        }}
      />
      <div className={`${container} pt-8 sm:pt-12`}>
        <Link href={`/site/${uni}#courses`} className="text-[14px] text-muted hover:text-ink">
          ← All courses
        </Link>
        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_340px] lg:gap-16">
          <div>
            <div className="text-[14px] text-muted">{course.departmentName}</div>
            <h1 className="mt-1 text-balance text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">{course.title}</h1>
            {course.description && <p className="mt-5 max-w-[62ch] text-[18px] leading-relaxed text-ink/85">{course.description}</p>}
            {avg !== null && (
              <a href="#course-reviews" className="mt-5 inline-flex items-center gap-2 text-[14px] text-muted hover:text-ink">
                <Stars rating={avg} className="text-[var(--site-primary)]" />
                {avg.toFixed(1)} from {course.reviews.length === 1 ? "1 review" : `${course.reviews.length} reviews`}
              </a>
            )}
          </div>
          <aside className="h-fit rounded-[28px] bg-[var(--site-deep)] p-7 text-[var(--site-on-primary)]">
            <div className="text-[14px] text-[var(--site-on-primary)]/70">Fee</div>
            <div className="tabular mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em]">{course.pricePaise ? formatINR(course.pricePaise) : "Free"}</div>
            {course.pricePaise > 0 && (
              <div className="mt-2 text-[14px] text-[var(--site-on-primary)]/70">
                + {course.gstRateBp / 100}% GST, {formatINR(total)} in all
              </div>
            )}
            {anyOpen ? (
              <a href={course.enrolHref} className="mt-6 flex h-12 items-center justify-center rounded-full bg-[var(--site-on-primary)] text-[15px] font-medium text-[var(--site-deep)] hover:opacity-90">
                Enrol
              </a>
            ) : (
              <a href="#course-enquiry" className="mt-6 flex h-12 items-center justify-center rounded-full border border-[var(--site-on-primary)]/35 text-[15px] font-medium hover:bg-[var(--site-on-primary)]/10">
                Ask about the next batch
              </a>
            )}
            <p className="mt-3 text-center text-[13px] text-[var(--site-on-primary)]/65">
              {anyOpen ? "You pick your batch and pay after signing in." : "Every open batch is full right now."}
            </p>
          </aside>
        </div>
      </div>

      <section aria-labelledby="batches-heading" className={`${container} mt-16`}>
        <h2 id="batches-heading" className="text-[26px] font-semibold tracking-[-0.02em]">
          Batches
        </h2>
        {course.batches.length === 0 ? (
          <p className="mt-4 text-[16px] text-muted">No batches are open right now. Leave your details below and we&apos;ll tell you when the next one opens.</p>
        ) : (
          <ul className="mt-6 divide-y divide-[var(--site-line)] border-y border-[var(--site-line)]">
            {course.batches.map((b) => (
              <li key={b.id} className="grid gap-x-8 gap-y-2 py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_230px] sm:items-center">
                <div>
                  <div className="text-[19px] font-semibold">{b.name}</div>
                  <div className="text-[14px] text-muted">
                    {formatDate(b.startDate)} to {formatDate(b.endDate)}
                  </div>
                </div>
                <div className="text-[15px] leading-relaxed">
                  <div className="font-medium">{b.timings}</div>
                  <div className="text-muted">{startLine(b)}</div>
                  {b.faculty.length > 0 && (
                    <div className="text-muted">
                      With{" "}
                      {b.faculty.map((f, i) => (
                        <span key={f.name}>
                          {i > 0 && (i === b.faculty.length - 1 ? " and " : ", ")}
                          {f.profileId ? (
                            <Link href={`/site/${uni}/faculty/${f.profileId}`} className="text-ink underline decoration-1 underline-offset-4">
                              {f.name}
                            </Link>
                          ) : (
                            f.name
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-5 sm:justify-end">
                  <span className="text-[15px]">
                    <SeatsLeft n={b.seatsLeft} limit={b.seatLimit} />
                  </span>
                  {b.seatsLeft > 0 && (
                    <a href={course.enrolHref} className="inline-flex h-10 items-center rounded-full bg-[var(--site-primary)] px-5 text-[14px] font-medium text-[var(--site-on-primary)] hover:opacity-90">
                      Enrol
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[13px] text-muted">
          Seats update every minute. Times are in {site.timezone === "Asia/Kolkata" ? "Indian Standard Time" : `the ${site.timezone.replace(/_/g, " ")} time zone`}.
        </p>
      </section>

      {course.reviews.length > 0 && (
        <section id="course-reviews" aria-labelledby="course-reviews-heading" className={`${container} mt-16 scroll-mt-20`}>
          <h2 id="course-reviews-heading" className="text-[26px] font-semibold tracking-[-0.02em]">
            What students say
          </h2>
          <ul className="mt-6 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {course.reviews.map((r) => (
              <li key={r.id}>
                <Stars rating={r.rating} className="text-[var(--site-primary)]" />
                <p className="mt-2 text-[16px] leading-relaxed">{r.body}</p>
                <p className="mt-2 text-[14px] text-muted">
                  <span className="font-medium text-ink">{r.name}</span>, {formatDate(r.date.slice(0, 10))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="course-enquiry" aria-labelledby="course-enquiry-heading" className="mt-20 scroll-mt-20 bg-[var(--site-soft)] py-16">
        <div className={`${container} grid gap-10 lg:grid-cols-[1fr_1.15fr]`}>
          <div>
            <h2 id="course-enquiry-heading" className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">
              Questions about {course.title}?
            </h2>
            <p className="mt-3 max-w-md text-[17px] text-muted">Ask about the syllabus, fees, instalments or which batch suits you. Our admissions team replies within one working day.</p>
            <p className="mt-6 text-[15px] text-muted">{priceLine(course)}</p>
          </div>
          <div className="rounded-[28px] bg-surface p-6 sm:p-8">
            <EnquiryForm uni={uni} action={submitEnquiryAction} courses={home?.courseOptions ?? [{ id: course.id, title: course.title }]} courseId={course.id} source="course" />
          </div>
        </div>
      </section>
    </>
  );
}
