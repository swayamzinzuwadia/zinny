import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { createPostAction } from "@/modules/website-builder/actions";
import { listPosts } from "@/modules/website-builder/blog";
import { NoAccess, SectionTabs, Thumb } from "@/modules/website-builder/components/admin";
import { formatMoment } from "@/modules/website-builder/format";
import { mediaPath } from "@/modules/website-builder/media";
import { attentionCounts } from "@/modules/website-builder/overview";

export const metadata = { title: "Blog" };

export default async function BlogPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Blog" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [posts, counts] = await Promise.all([listPosts(actor), attentionCounts(actor)]);
  const base = `/${uni}/admin/website/sections/blog`;

  return (
    <>
      <PageHeader
        title="Blog"
        subtitle="News, results and advice for students. Drafts stay private; published posts appear on your blog and in the Blog highlights section."
        actions={
          <a href={`/site/${uni}/blog`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
            View blog
          </a>
        }
      />
      <SectionTabs uni={uni} active="blog" counts={counts} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {posts.length === 0 ? (
            <Empty title="No posts yet">Start one on the right. Placement results, admissions dates and student stories are good first posts.</Empty>
          ) : (
            <Table head={["Post", "Author", "Status", "Updated"]}>
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`${base}/${p.id}`} className="flex items-center gap-3 font-medium text-ink hover:text-brand">
                      <Thumb src={p.coverMediaId ? mediaPath(uni, p.coverMediaId) : null} name={p.title} size={44} />
                      <span>{p.title}</span>
                    </Link>
                  </Td>
                  <Td className="text-muted">{p.authorName ?? "No author"}</Td>
                  <Td>{p.status === "published" ? <Badge tone="brand">Published</Badge> : <Badge>Draft</Badge>}</Td>
                  <Td className="whitespace-nowrap text-[13px] text-muted">{formatMoment(p.updatedAt, university.timezone)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Card className="h-fit">
          <CardTitle>New post</CardTitle>
          <ActionForm action={createPostAction} className="space-y-4">
            <input type="hidden" name="uni" value={uni} />
            <Field label="Title" hint="You can change it later.">
              <Input name="title" required minLength={3} maxLength={140} placeholder="Placements 2026: where our graduates went" />
            </Field>
            <SubmitButton pendingText="Creating…">Start writing</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
