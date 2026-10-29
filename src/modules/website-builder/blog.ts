/**
 * Blog posts: a title, a web address (slug), a cover image, rich text (sanitised on every
 * save), an excerpt and an author. Drafts are never public; publishing needs a cover image
 * and some text. Unpublishing takes a post off the site again.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, peopleLite, withTenant, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertManage, staffPeople } from "./access";
import { assertMediaOf } from "./media";
import { sanitizeBlogHtml, textOf } from "./sanitize";
import { sitePosts } from "./schema";
import { cleanSlug, isUuid, optionalText, requireText, slugify } from "./validate";

export type Post = typeof sitePosts.$inferSelect;

export const MAX_BODY_CHARS = 100_000;

async function uniqueSlug(tx: Tx, base: string, exceptId?: string): Promise<string> {
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 76)}-${i}`;
    const [taken] = await tx
      .select({ id: sitePosts.id })
      .from(sitePosts)
      .where(and(eq(sitePosts.slug, candidate), exceptId ? ne(sitePosts.id, exceptId) : undefined));
    if (!taken) return candidate;
  }
  throw new ConflictError("Too many posts share this title. Give the post a different web address.");
}

async function loadPost(tx: Tx, id: string) {
  if (!isUuid(id)) throw new NotFoundError("Post");
  const [p] = await tx.select().from(sitePosts).where(eq(sitePosts.id, id));
  if (!p) throw new NotFoundError("Post");
  return p;
}

export async function listPosts(actor: Actor) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const rows = await tx.select().from(sitePosts).orderBy(desc(sitePosts.updatedAt));
    const people = await peopleLite(tx, rows.flatMap((r) => (r.authorUserId ? [r.authorUserId] : [])));
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, authorName: r.authorUserId ? (nameOf.get(r.authorUserId) ?? "Former staff") : null }));
  });
}

export async function getPost(actor: Actor, id: string) {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => ({ post: await loadPost(tx, id), authors: await staffPeople(tx, universityId) }));
}

/** Start a draft from a title. The author is you. */
export async function createPost(actor: Actor, input: { title?: string }) {
  const universityId = assertManage(actor);
  const title = requireText(input.title, "The title", { min: 3, max: 140 });
  return withTenant(actor, async (tx) => {
    const slug = await uniqueSlug(tx, slugify(title));
    const [post] = await tx
      .insert(sitePosts)
      .values({ universityId, title, slug, authorUserId: actor.userId || null, updatedBy: actor.userId || null })
      .returning();
    await audit(tx, actor, "site.create_post", "site_post", post.id, { title });
    return post;
  });
}

export type PostInput = {
  title?: string;
  slug?: string;
  excerpt?: string;
  bodyHtml?: string;
  coverMediaId?: string | null;
  authorUserId?: string | null;
};

export async function updatePost(actor: Actor, id: string, input: PostInput) {
  const universityId = assertManage(actor);
  const title = requireText(input.title, "The title", { min: 3, max: 140 });
  const slug = cleanSlug(input.slug);
  const excerpt = optionalText(input.excerpt, "The summary", 300);
  if ((input.bodyHtml ?? "").length > MAX_BODY_CHARS) throw new ValidationError("The post is too long. Split it into two posts.");
  const bodyHtml = sanitizeBlogHtml(input.bodyHtml ?? "");
  return withTenant(actor, async (tx) => {
    const current = await loadPost(tx, id);
    const [clash] = await tx.select({ id: sitePosts.id }).from(sitePosts).where(and(eq(sitePosts.slug, slug), ne(sitePosts.id, id)));
    if (clash) throw new ConflictError(`Another post already uses the web address "${slug}". Pick a different one.`);
    const coverMediaId = input.coverMediaId === undefined ? current.coverMediaId : input.coverMediaId || null;
    await assertMediaOf(tx, coverMediaId);
    let authorUserId = input.authorUserId === undefined ? current.authorUserId : input.authorUserId || null;
    if (authorUserId && authorUserId !== current.authorUserId) {
      const staff = await staffPeople(tx, universityId);
      if (!staff.some((p) => p.id === authorUserId)) throw new ValidationError("Pick the author from the list of staff.");
    }
    if (current.status === "published") assertPublishable({ coverMediaId, bodyHtml });
    authorUserId = authorUserId ?? null;
    const [saved] = await tx
      .update(sitePosts)
      .set({ title, slug, excerpt, bodyHtml, coverMediaId, authorUserId, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(sitePosts.id, id))
      .returning();
    await audit(tx, actor, "site.update_post", "site_post", id, { slugChanged: slug !== current.slug ? current.slug : undefined, status: saved.status });
    return { post: saved, previousSlug: current.slug };
  });
}

function assertPublishable(p: { coverMediaId: string | null; bodyHtml: string }) {
  if (!p.coverMediaId) throw new ValidationError("Add a cover image before publishing. Posts without one look broken in the blog list.");
  if (textOf(p.bodyHtml).length < 50) throw new ValidationError("Write the post before publishing: it needs at least a few sentences.");
}

export async function publishPost(actor: Actor, id: string) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const post = await loadPost(tx, id);
    assertPublishable(post);
    const [saved] = await tx
      .update(sitePosts)
      .set({ status: "published", publishedAt: post.publishedAt ?? new Date(), updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(sitePosts.id, id))
      .returning();
    await audit(tx, actor, "site.publish_post", "site_post", id, { slug: saved.slug });
    return saved;
  });
}

export async function unpublishPost(actor: Actor, id: string) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    await loadPost(tx, id);
    const [saved] = await tx.update(sitePosts).set({ status: "draft", updatedAt: new Date(), updatedBy: actor.userId || null }).where(eq(sitePosts.id, id)).returning();
    await audit(tx, actor, "site.unpublish_post", "site_post", id, { slug: saved.slug });
    return saved;
  });
}

export async function deletePost(actor: Actor, id: string) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const post = await loadPost(tx, id);
    await tx.delete(sitePosts).where(eq(sitePosts.id, id));
    await audit(tx, actor, "site.delete_post", "site_post", id, { title: post.title, slug: post.slug });
    return post;
  });
}
