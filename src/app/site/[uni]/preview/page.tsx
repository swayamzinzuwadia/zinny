import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { getSite } from "@/modules/website-builder/cached";
import { HomeSections } from "@/modules/website-builder/components/site/home";
import { PreviewBar } from "@/modules/website-builder/components/site/preview-bar";
import { container } from "@/modules/website-builder/components/site/bits";
import { previewHome } from "@/modules/website-builder/public";

/** The draft home page, for website managers only. Never cached, never indexed. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Draft preview", robots: { index: false, follow: false } };

export default async function PreviewPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return <p className={`${container} py-20 text-[17px]`}>Only website managers can preview drafts. Ask an Institute Admin.</p>;
  }
  const data = await previewHome(actor, uni);
  return (
    <>
      <PreviewBar back={{ href: `/${uni}/admin/website/profile/builder`, label: "Back to the website builder" }}>
        Visitors see this only after you publish.
      </PreviewBar>
      {data.sections.length === 0 ? (
        <p className={`${container} py-20 text-[17px] text-muted`}>Every section is hidden. Show at least one in the website builder.</p>
      ) : (
        <HomeSections uni={uni} site={site} data={data} />
      )}
    </>
  );
}
