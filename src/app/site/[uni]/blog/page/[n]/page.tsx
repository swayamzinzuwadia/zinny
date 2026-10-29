import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPosts, getSite } from "@/modules/website-builder/cached";
import { BlogIndex } from "@/modules/website-builder/components/site/blog";

export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ uni: string; n: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uni, n } = await params;
  return { title: `Blog, page ${Number(n) || 1}`, alternates: { canonical: `/site/${uni}/blog/page/${n}` } };
}

export default async function BlogPageN({ params }: Props) {
  const { uni, n } = await params;
  if (!/^\d{1,4}$/.test(n)) notFound();
  const page = Number(n);
  if (page === 1) redirect(`/site/${uni}/blog`);
  const site = await getSite(uni);
  if (!site) notFound();
  const result = await getPosts(uni, site.universityId, page);
  if (!result) notFound();
  return <BlogIndex uni={uni} siteName={site.name} posts={result.posts} page={page} pages={result.pages} />;
}
