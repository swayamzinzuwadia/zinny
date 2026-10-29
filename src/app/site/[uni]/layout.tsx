import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { paletteStyle } from "@/modules/website-builder/branding";
import { getSite } from "@/modules/website-builder/cached";
import { SiteFooter, SiteHeader } from "@/modules/website-builder/components/site/chrome";
import { truncate } from "@/modules/website-builder/format";

/** Every university's public site. Rendered statically on first visit and kept until the site changes. */
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ uni: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) return {};
  const description = site.tagline || (site.about ? truncate(site.about, 160) : `${site.name}: courses, faculty and admissions.`);
  return {
    title: { default: site.name, template: `%s | ${site.name}` },
    description,
    applicationName: site.name,
    openGraph: {
      siteName: site.name,
      type: "website",
      locale: "en_IN",
      title: site.name,
      description,
      ...(site.cover && { images: [{ url: site.cover.src, width: site.cover.width, height: site.cover.height, alt: site.name }] }),
    },
    twitter: { card: site.cover ? "summary_large_image" : "summary" },
    ...(site.logo && { icons: { icon: site.logo.src, apple: site.logo.src } }),
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { uni } = await params;
  const site = await getSite(uni);
  return { themeColor: site?.palette.primary ?? "#0b5e4c" };
}

export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  return (
    <div style={paletteStyle(site.palette) as CSSProperties} className="flex min-h-dvh flex-col bg-canvas text-ink selection:bg-[var(--site-soft)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <SiteHeader site={site} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter site={site} />
    </div>
  );
}
