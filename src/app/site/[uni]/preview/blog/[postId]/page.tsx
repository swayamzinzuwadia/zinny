import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { getSite } from "@/modules/website-builder/cached";
import { container } from "@/modules/website-builder/components/site/bits";
import { PostView } from "@/modules/website-builder/components/site/blog";
import { PreviewBar } from "@/modules/website-builder/components/site/preview-bar";
import { previewPost } from "@/modules/website-builder/public";

/** Any post as it will look, for website managers only. Never cached, never indexed. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post preview", robots: { index: false, follow: false } };

export default async function PostPreviewPage({ params }: { params: Promise<{ uni: string; postId: string }> }) {
  const { uni, postId } = await params;
  const site = await getSite(uni);
  if (!site) notFound();
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return <p className={`${container} py-20 text-[17px]`}>Only website managers can preview posts. Ask an Institute Admin.</p>;
  }
  const post = await previewPost(actor, uni, postId);
  if (!post) notFound();
  return (
    <>
      <PreviewBar back={{ href: `/${uni}/admin/website/sections/blog/${postId}`, label: "Back to the editor" }}>
        {post.isDraft ? "This post is a draft; visitors can't see it." : "This post is live; this shows your last saved version."}
      </PreviewBar>
      <PostView uni={uni} post={post} />
    </>
  );
}
