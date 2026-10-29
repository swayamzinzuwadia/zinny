import Link from "next/link";
import { PageHeader, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { NoAccess, SectionTabs } from "@/modules/website-builder/components/admin";
import { plural } from "@/modules/website-builder/format";
import { siteOverview } from "@/modules/website-builder/overview";

export const metadata = { title: "Website sections" };

export default async function SectionsOverviewPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Website sections" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const o = await siteOverview(actor);
  const base = `/${uni}/admin/website/sections`;
  const tiles: { key: string; title: string; line: string; attention?: string }[] = [
    {
      key: "enquiries",
      title: "Enquiries",
      line: `${plural(o.enquiries.contacted, "enquiry", "enquiries")} in progress`,
      attention: o.enquiries.new ? `${plural(o.enquiries.new, "new enquiry", "new enquiries")}` : undefined,
    },
    {
      key: "reviews",
      title: "Reviews",
      line: `${plural(o.reviews.approved, "approved review")} on the website`,
      attention: o.reviews.pending ? `${o.reviews.pending} waiting for you` : undefined,
    },
    { key: "testimonials", title: "Testimonials", line: `${o.testimonials.shown} of ${o.testimonials.total} shown` },
    { key: "gallery", title: "Gallery", line: `${o.gallery.shown} of ${plural(o.gallery.total, "photo")} shown` },
    { key: "videos", title: "Videos", line: `${o.videos.shown} of ${plural(o.videos.total, "video")} shown` },
    { key: "blog", title: "Blog", line: `${o.posts.published} published, ${plural(o.posts.drafts, "draft")}` },
    { key: "team", title: "Team", line: `${o.team.shown} of ${plural(o.team.total, "person", "people")} shown` },
  ];

  return (
    <>
      <PageHeader
        title="Website sections"
        subtitle="The content inside your website: what visitors read, and what they send you. Items marked as shown appear on the site straight away."
      />
      <SectionTabs uni={uni} active="overview" counts={{ enquiries: o.enquiries.new, reviews: o.reviews.pending }} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={`${base}/${t.key}`}
            className={cx(
              "group rounded-[22px] border bg-surface px-5 py-4 transition-colors hover:border-brand/40",
              t.attention ? "border-gold/60" : "border-line",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[17px] font-medium group-hover:text-brand">{t.title}</span>
              {t.attention && <span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-[12px] font-medium text-gold-strong">{t.attention}</span>}
            </div>
            <div className="mt-1 text-[14px] text-muted">{t.line}</div>
          </Link>
        ))}
      </div>
      {!o.page.live && (
        <p className="mt-8 text-[14px] text-muted">
          Your website isn&apos;t published yet.{" "}
          <Link href={`/${uni}/admin/website/profile/builder`} className="text-brand underline underline-offset-2">
            Open the website builder
          </Link>{" "}
          to arrange the home page and publish it.
        </p>
      )}
    </>
  );
}
