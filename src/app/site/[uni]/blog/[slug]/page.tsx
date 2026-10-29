import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPost, getSite } from "@/modules/website-builder/cached";
import { JsonLd } from "@/modules/website-builder/components/site/bits";
import { PostView } from "@/modules/website-builder/components/site/blog";

export const revalidate = 3600;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ uni: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uni, slug } = await params;
  const site = await getSite(uni);
  const post = site ? await getPost(uni, site.universityId, slug) : null;
  if (!site || !post) return {};
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/site/${uni}/blog/${post.slug}` },
    authors: post.authorName ? [{ name: post.authorName }] : undefined,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      ...(post.authorName && { authors: [post.authorName] }),
      ...(post.cover && { images: [{ url: post.cover.src, width: post.cover.width, height: post.cover.height, alt: post.title }] }),
    },
    twitter: { card: post.cover ? "summary_large_image" : "summary", title: post.title, description: post.excerpt },
  };
}

export default async function PostPage({ params }: Props) {
  const { uni, slug } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const post = await getPost(uni, site.universityId, slug);
  if (!post) notFound();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt,
          datePublished: post.publishedAt,
          dateModified: post.updatedAt,
          ...(post.cover && { image: post.cover.src }),
          ...(post.authorName && { author: { "@type": "Person", name: post.authorName } }),
          publisher: { "@type": "CollegeOrUniversity", name: site.name },
        }}
      />
      <PostView uni={uni} post={post} />
    </>
  );
}
