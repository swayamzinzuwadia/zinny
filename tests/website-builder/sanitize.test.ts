import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { createPost, publishPost, updatePost } from "@/modules/website-builder/blog";
import { publishPage } from "@/modules/website-builder/builder";
import { uploadImage } from "@/modules/website-builder/media";
import { publicPost } from "@/modules/website-builder/public";
import { readingMinutes, sanitizeBlogHtml, textOf } from "@/modules/website-builder/sanitize";
import { sitePosts } from "@/modules/website-builder/schema";
import { png, siteFixture } from "./helpers";

afterAll(closeDb);

describe("website-builder: blog HTML is sanitised", () => {
  it("removes scripts, styles, frames, images, event handlers and inline styles", () => {
    const out = sanitizeBlogHtml(
      `<p onclick="steal()" style="color:red" class="x">Hi <script>alert(1)</script><b>bold</b></p>` +
        `<img src=x onerror=alert(1)><iframe src="https://evil.example"></iframe><style>p{color:red}</style>` +
        `<svg><script>alert(1)</script></svg><object data="x"></object><form action="/x"><input name="a"></form>` +
        `<math><mi>x</mi></math><noscript><p>no</p></noscript>`,
    );
    expect(out).toBe("<p>Hi <strong>bold</strong></p>");
    expect(out).not.toMatch(/script|onerror|onclick|style|iframe|img|svg|form|input/i);
  });

  it("turns unsafe links into plain text and marks external links", () => {
    const out = sanitizeBlogHtml(
      `<p><a href="javascript:alert(1)">a</a> <a href=" JaVaScRiPt:alert(1)">b</a> <a href="java&#x09;script:alert(1)">c</a> ` +
        `<a href="data:text/html,<script>alert(1)</script>">d</a> <a href="//evil.example">e</a> <a href="vbscript:x">f</a> <a>g</a> ` +
        `<a href="https://example.com" target="_self" rel="opener">ok</a> <a href="/site/demo/courses">inside</a> <a href="mailto:a@b.co">mail</a></p>`,
    );
    expect(out).toBe(
      `<p>a b c d e f g <a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">ok</a> <a href="/site/demo/courses">inside</a> <a href="mailto:a@b.co">mail</a></p>`,
    );
  });

  it("keeps the formatting the editor produces, and normalises the rest", () => {
    const html = `<h2>Title</h2><h3>Sub</h3><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>x</code></p><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><blockquote><p>q</p></blockquote><hr><pre><code>select 1;</code></pre>`;
    expect(sanitizeBlogHtml(html)).toBe(html.replace("<hr>", "<hr />"));
    expect(sanitizeBlogHtml(`<h1>Big</h1><h4>Small</h4><div>Block</div><i>it</i><b>bo</b>`)).toBe("<h2>Big</h2><h3>Small</h3><p>Block</p><em>it</em><strong>bo</strong>");
    // The empty paragraphs the editor leaves at the end are dropped.
    expect(sanitizeBlogHtml("<p>Text</p><p></p><p><br /></p>")).toBe("<p>Text</p>");
  });

  it("text helpers read the words, not the markup", () => {
    expect(textOf("<p>A &amp; B</p><p>C<br/>D</p>")).toBe("A & B C D");
    expect(readingMinutes(`<p>${"word ".repeat(600)}</p>`)).toBe(3);
    expect(readingMinutes("")).toBe(1);
  });

  it("posts are stored sanitised, so the public page never serves the attack", async () => {
    const { uni, admin } = await siteFixture("Sanitise U");
    await publishPage(admin);
    const post = await createPost(admin, { title: "Hello <script>" });
    const cover = await uploadImage(admin, { kind: "post", bytes: await png() });
    await updatePost(admin, post.id, {
      title: "Hello",
      slug: "hello",
      coverMediaId: cover.id,
      bodyHtml: `<p>Enough words to publish this post on the site today.</p><img src=x onerror="fetch('//evil')"><a href="javascript:steal()">click</a><script>steal()</script>`,
    });
    const [stored] = await systemDb().select().from(sitePosts).where(eq(sitePosts.id, post.id));
    expect(stored.bodyHtml).toBe("<p>Enough words to publish this post on the site today.</p>click");
    await publishPost(admin, post.id);
    expect((await publicPost(uni.id, uni.slug, "hello"))?.bodyHtml).not.toMatch(/script|onerror|javascript/);
  });
});
