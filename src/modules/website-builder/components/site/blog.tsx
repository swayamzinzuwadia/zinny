import Link from "next/link";
import { cx } from "@/components/ui";
import { formatDate } from "../../format";
import type { PublicPost, PublicPostCard } from "../../public";
import { PROSE } from "../prose";
import { container, PostCard, SiteImage } from "./bits";

export function BlogIndex({ uni, siteName, posts, page, pages }: { uni: string; siteName: string; posts: PublicPostCard[]; page: number; pages: number }) {
  const [first, ...rest] = page === 1 ? posts : [undefined, ...posts];
  return (
    <div className={`${container} pt-10 sm:pt-14`}>
      <h1 className="text-[40px] font-semibold leading-tight tracking-[-0.03em] sm:text-[52px]">Blog</h1>
      <p className="mt-3 max-w-xl text-[17px] text-muted">News, results and advice from {siteName}.</p>
      {posts.length === 0 ? (
        <p className="mt-12 text-[17px] text-muted">No posts yet. Check back soon.</p>
      ) : (
        <>
          {first && (
            <div className="mt-12">
              <PostCard uni={uni} p={first} large />
            </div>
          )}
          {rest.length > 0 && (
            <div className={cx("grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3", first ? "mt-16" : "mt-12")}>
              {rest.map((p) => p && <PostCard key={p.id} uni={uni} p={p} />)}
            </div>
          )}
        </>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-16 flex items-center justify-between border-t border-[var(--site-line)] pt-6 text-[15px]">
          {page > 1 ? (
            <Link href={page === 2 ? `/site/${uni}/blog` : `/site/${uni}/blog/page/${page - 1}`} className="font-medium text-[var(--site-primary)]">
              Newer posts
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`/site/${uni}/blog/page/${page + 1}`} className="font-medium text-[var(--site-primary)]">
              Older posts
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

/** One post. `bodyHtml` was sanitised when it was saved (sanitize.ts), so it is safe to render. */
export function PostView({ uni, post }: { uni: string; post: PublicPost }) {
  return (
    <article className="pt-8 sm:pt-12">
      <header className={container}>
        <Link href={`/site/${uni}/blog`} className="text-[14px] text-muted hover:text-ink">
          ← Blog
        </Link>
        <div className="mx-auto mt-8 max-w-[720px]">
          <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[46px]">{post.title}</h1>
          {post.excerpt && <p className="mt-4 text-[19px] leading-relaxed text-muted">{post.excerpt}</p>}
          <p className="mt-6 text-[14px] text-muted">
            {post.authorName && (
              <>
                By{" "}
                {post.authorProfileId ? (
                  <Link href={`/site/${uni}/faculty/${post.authorProfileId}`} className="font-medium text-ink underline decoration-1 underline-offset-4">
                    {post.authorName}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{post.authorName}</span>
                )}
                ,{" "}
              </>
            )}
            {post.isDraft ? "not published yet" : <time dateTime={post.publishedAt}>{formatDate(post.publishedAt.slice(0, 10))}</time>}, {post.minutes} min read
          </p>
        </div>
        {post.cover && (
          <div className="mx-auto mt-10 max-w-5xl overflow-hidden rounded-[28px] bg-[var(--site-soft)]">
            <SiteImage image={post.cover} alt="" priority sizes="(min-width: 1024px) 1024px, 100vw" className="h-auto w-full" />
          </div>
        )}
      </header>
      <div className={`${container} mt-12`}>
        <div className={cx("mx-auto max-w-[720px] [&_a]:text-[var(--site-primary)] [&_blockquote]:border-[var(--site-primary)]", PROSE)} dangerouslySetInnerHTML={{ __html: post.bodyHtml }} />
      </div>
      {post.related.length > 0 && (
        <aside aria-labelledby="related-heading" className={`${container} mt-20 border-t border-[var(--site-line)] pt-12`}>
          <h2 id="related-heading" className="text-[22px] font-semibold tracking-[-0.01em]">
            More from the blog
          </h2>
          <div className="mt-8 grid gap-x-8 gap-y-12 sm:grid-cols-2">
            {post.related.map((p) => (
              <PostCard key={p.id} uni={uni} p={p} />
            ))}
          </div>
        </aside>
      )}
    </article>
  );
}
