import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHome, getSite } from "@/modules/website-builder/cached";
import { JsonLd } from "@/modules/website-builder/components/site/bits";
import { ComingSoon, HomeSections } from "@/modules/website-builder/components/site/home";

/** Seconds (matches REVALIDATE.home). Every publish refreshes it at once. */
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ uni: string }> }): Promise<Metadata> {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) return {};
  return { alternates: { canonical: `/site/${uni}` }, robots: site.live ? undefined : { index: false } };
}

export default async function SiteHome({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const data = await getHome(uni, site.universityId);
  if (!data) return <ComingSoon site={site} />;
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollegeOrUniversity",
          name: site.name,
          ...(site.tagline && { description: site.tagline }),
          ...(site.logo && { logo: site.logo.src }),
          ...(site.email && { email: site.email }),
          ...(site.phone && { telephone: site.phone }),
          ...(site.foundedYear && { foundingDate: String(site.foundedYear) }),
          ...(site.address && { address: site.address.replace(/\s*\n\s*/g, ", ") }),
          ...(Object.values(site.social).length && { sameAs: Object.values(site.social) }),
        }}
      />
      <HomeSections uni={uni} site={site} data={data} />
    </>
  );
}
