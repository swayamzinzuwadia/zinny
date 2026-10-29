import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPosts, getSite } from "@/modules/website-builder/cached";
import { BlogIndex } from "@/modules/website-builder/components/site/blog";

/** Seconds; every post change also refreshes it at once. */
export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ uni: string }> }): Promise<Metadata> {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) return {};
  return { title: "Blog", description: `News, results and advice from ${site.name}.`, alternates: { canonical: `/site/${uni}/blog` } };
}

export default async function BlogPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const result = await getPosts(uni, site.universityId, 1);
  if (!result) notFound();
  return <BlogIndex uni={uni} siteName={site.name} posts={result.posts} page={1} pages={result.pages} />;
}
