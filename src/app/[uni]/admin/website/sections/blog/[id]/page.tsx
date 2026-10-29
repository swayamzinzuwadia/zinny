import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { canManageSite } from "@/modules/website-builder/access";
import { deletePostAction, savePostAction, unpublishPostAction } from "@/modules/website-builder/actions";
import { getPost } from "@/modules/website-builder/blog";
import { ActionButton } from "@/modules/website-builder/components/action-button";
import { NoAccess } from "@/modules/website-builder/components/admin";
import { ImageField } from "@/modules/website-builder/components/image-field";
import { IntentButton } from "@/modules/website-builder/components/intent-button";
import { RichTextEditor } from "@/modules/website-builder/components/rich-text-editor";
import { formatMoment } from "@/modules/website-builder/format";
import { mediaPath } from "@/modules/website-builder/media";

export const metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) return <NoAccess uni={uni} />;
  const { post, authors } = await getPost(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const published = post.status === "published";

  return (
    <>
      <Link href={`/${uni}/admin/website/sections/blog`} className="text-sm text-muted hover:text-ink">
        ← Blog
      </Link>
      <div className="mb-8 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-tight">{post.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[14px] text-muted">
            {published ? <Badge tone="brand">Published</Badge> : <Badge>Draft</Badge>}
            {published && post.publishedAt && <span>Published {formatMoment(post.publishedAt, university.timezone)}</span>}
            <span>Last saved {formatMoment(post.updatedAt, university.timezone)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/site/${uni}/preview/blog/${post.id}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
            Preview
          </a>
          {published && (
            <a href={`/site/${uni}/blog/${post.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-brand hover:bg-brand-soft">
              View live post
            </a>
          )}
        </div>
      </div>

      <ActionForm action={savePostAction} resetOnSuccess={false}>
        <input type="hidden" name="uni" value={uni} />
        <input type="hidden" name="id" value={post.id} />
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Field label="Title">
              <Input name="title" defaultValue={post.title} required minLength={3} maxLength={140} className="h-12 text-[18px] font-medium" />
            </Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium">Post</span>
              <RichTextEditor name="bodyHtml" initialHtml={post.bodyHtml} label="Post text" />
            </div>
          </div>
          <div className="space-y-5">
            <Card>
              <CardTitle>{published ? "Update" : "Publish"}</CardTitle>
              <p className="mb-4 text-[13px] text-muted">
                {published ? "Saving updates the live post straight away." : "Publishing puts the post on your blog. It needs a cover image and a few sentences."}
              </p>
              <div className="flex flex-wrap gap-2">
                {published ? (
                  <IntentButton intent="save" pendingText="Saving…">
                    Save changes
                  </IntentButton>
                ) : (
                  <>
                    <IntentButton intent="save" variant="secondary" pendingText="Saving…">
                      Save draft
                    </IntentButton>
                    <IntentButton intent="publish" pendingText="Publishing…">
                      Publish post
                    </IntentButton>
                  </>
                )}
              </div>
            </Card>
            <Card>
              <CardTitle>Details</CardTitle>
              <div className="space-y-4">
                <ImageField
                  key={post.coverMediaId ?? "none"}
                  uni={uni}
                  kind="post"
                  name="coverMediaId"
                  label="Cover image"
                  hint="Wide, at least 1200 pixels across. Also used when the post is shared."
                  initial={post.coverMediaId ? { id: post.coverMediaId, src: mediaPath(uni, post.coverMediaId) } : null}
                />
                <Field label="Summary" hint="Shown in the blog list and in search results. One or two sentences.">
                  <Textarea name="excerpt" defaultValue={post.excerpt} maxLength={300} rows={3} className="text-[14px]" />
                </Field>
                <Field label="Web address" hint={`/site/${uni}/blog/… Lowercase letters, numbers and dashes.`}>
                  <Input name="slug" defaultValue={post.slug} required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" className="font-mono text-[13px]" />
                </Field>
                <Field label="Author">
                  <Select name="authorUserId" defaultValue={post.authorUserId ?? ""}>
                    <option value="">No author shown</option>
                    {authors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Card>
          </div>
        </div>
      </ActionForm>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6">
        {published && (
          <ActionButton action={unpublishPostAction} fields={{ uni, id: post.id }} confirm="Take this post off your website? It becomes a draft again." size="md">
            Unpublish
          </ActionButton>
        )}
        <ActionButton action={deletePostAction} fields={{ uni, id: post.id }} variant="danger" confirm={`Delete “${post.title}” for good? This can't be undone.`} size="md">
          Delete post
        </ActionButton>
      </div>
    </>
  );
}
