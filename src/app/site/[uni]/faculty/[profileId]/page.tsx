import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFacultyProfile, getSite } from "@/modules/website-builder/cached";
import { container, JsonLd, Paragraphs, SiteImage } from "@/modules/website-builder/components/site/bits";
import { initials, truncate } from "@/modules/website-builder/format";

export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ uni: string; profileId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uni, profileId } = await params;
  const site = await getSite(uni);
  const f = site ? await getFacultyProfile(uni, site.universityId, profileId) : null;
  if (!site || !f) return {};
  return {
    title: f.name,
    description: f.headline ? `${f.headline}. ${truncate(f.bio, 120)}` : truncate(f.bio, 160),
    alternates: { canonical: `/site/${uni}/faculty/${f.id}` },
    openGraph: { type: "profile", title: `${f.name} | ${site.name}`, ...(f.photo && { images: [{ url: f.photo.src, width: f.photo.width, height: f.photo.height }] }) },
  };
}

export default async function FacultyProfilePage({ params }: Props) {
  const { uni, profileId } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const f = await getFacultyProfile(uni, site.universityId, profileId);
  if (!f) notFound();

  return (
    <div className={`${container} pt-8 sm:pt-12`}>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Person", name: f.name, jobTitle: f.headline, worksFor: { "@type": "CollegeOrUniversity", name: site.name } }} />
      <Link href={`/site/${uni}#faculty`} className="text-[14px] text-muted hover:text-ink">
        ← Faculty
      </Link>
      <div className="mt-8 grid gap-10 md:grid-cols-[300px_1fr] lg:gap-16">
        <div className="relative aspect-[4/5] w-full max-w-[300px] overflow-hidden rounded-[28px] bg-[var(--site-soft)]">
          {f.photo ? (
            <SiteImage image={f.photo} alt={`Photo of ${f.name}`} priority sizes="300px" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-[64px] font-semibold text-[var(--site-primary)]">{initials(f.name)}</span>
          )}
        </div>
        <div>
          <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.03em] sm:text-[46px]">{f.name}</h1>
          {f.headline && <p className="mt-2 text-[19px] text-[var(--site-primary)]">{f.headline}</p>}
          <div className="mt-8 max-w-[64ch] space-y-5 text-[17px] leading-[1.75] text-ink/90">
            <Paragraphs text={f.bio} />
          </div>
          {f.subjects.length > 0 && (
            <div className="mt-10">
              <h2 className="text-[14px] text-muted">Subjects</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {f.subjects.map((s) => (
                  <li key={s} className="rounded-full border border-[var(--site-line)] px-3.5 py-1.5 text-[14px]">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.courses.length > 0 && (
            <div className="mt-10">
              <h2 className="text-[14px] text-muted">Teaches</h2>
              <ul className="mt-3 space-y-2">
                {f.courses.map((c) => (
                  <li key={c.id}>
                    <Link href={`/site/${uni}/courses/${c.id}`} className="text-[17px] font-medium text-[var(--site-primary)] underline decoration-1 underline-offset-4">
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
