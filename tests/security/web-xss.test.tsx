/**
 * Cross-site scripting and open redirects: every place user content becomes HTML or a link.
 * Rich text is sanitised with allow-lists (blog posts, lesson text, assignment instructions),
 * links only keep web schemes, emails escape their text, and sign-in only goes to our pages.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { sanitizeBlogHtml } from "@/modules/website-builder/sanitize";
import { cleanUrl } from "@/modules/website-builder/validate";
import { PostView } from "@/modules/website-builder/components/site/blog";
import type { PublicPost } from "@/modules/website-builder/public";
import { sanitizeLessonHtml } from "@/modules/content-progress/lib/sanitize";
import { normaliseLink } from "@/modules/content-progress/lib/kinds";
import { sanitizeInstructions } from "@/modules/assignments-polls/lib/sanitize";
import { safeMeetingUrl } from "@/modules/live-classes/time";
import { escapeHtml, textToHtml } from "@/modules/notifications-delivery/render";
import { demoRequestEmail } from "@/modules/zinny-team-panel/services/demo-requests";
import { safeNext } from "@/modules/identity/auth";

const PAYLOADS = [
  `<script>alert(1)</script>`,
  `<img src=x onerror="alert(1)">`,
  `<svg onload=alert(1)><circle/></svg>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<a href="javascript:alert(1)">click</a>`,
  `<a href="JaVaScRiPt:alert(1)">click</a>`,
  `<a href="&#106;avascript:alert(1)">click</a>`,
  `<a href=" javascript:alert(1)">click</a>`,
  `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>`,
  `<a href="vbscript:msgbox(1)">click</a>`,
  `<p style="background:url(javascript:alert(1))" onclick="alert(1)">x</p>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>`,
  `<form action="https://evil.test"><input name=a></form>`,
  `<object data="evil.swf"></object><embed src="evil.swf">`,
  `<base href="https://evil.test/">`,
  `<meta http-equiv="refresh" content="0;url=https://evil.test">`,
];

/** Nothing executable survives: no script-ish tags, handlers, inline styles or script URLs. */
function expectInert(html: string) {
  expect(html).not.toMatch(/<\s*(script|iframe|object|embed|svg|math|style|form|input|base|meta|img)\b/i);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/style\s*=/i);
  expect(html).not.toMatch(/(javascript|vbscript|data):/i);
}

describe("Rich text sanitisers", () => {
  it.each(PAYLOADS)("blog posts drop %s", (p) => expectInert(sanitizeBlogHtml(`<p>Hello</p>${p}`)));
  it.each(PAYLOADS)("lesson text drops %s", (p) => expectInert(sanitizeLessonHtml(`<p>Hello</p>${p}`)));
  it.each(PAYLOADS)("assignment instructions drop %s", (p) => expectInert(sanitizeInstructions(`<p>Hello</p>${p}`)));

  it("keep ordinary formatting and safe links, opened safely in a new tab", () => {
    const html = `<h2>Results</h2><p><strong>Well</strong> done, <a href="https://example.com/x">see more</a>.</p><ul><li>One</li></ul>`;
    for (const out of [sanitizeBlogHtml(html), sanitizeLessonHtml(html)]) {
      expect(out).toContain("<strong>Well</strong>");
      expect(out).toContain('href="https://example.com/x"');
      expect(out).toContain('rel="noopener noreferrer nofollow"');
      expect(out).toContain("<li>One</li>");
    }
  });

  it("the public blog page sanitises again when it renders, so a row changed outside the editor can't run script", () => {
    const post: PublicPost = {
      id: "p1",
      slug: "hello",
      title: "Hello",
      excerpt: "",
      cover: null,
      authorName: null,
      authorProfileId: null,
      publishedAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
      minutes: 1,
      related: [],
      isDraft: false,
      bodyHtml: `<p>Body</p><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>`,
    };
    const html = renderToStaticMarkup(<PostView uni="demo" post={post} />);
    expect(html).toContain("<p>Body</p>");
    expect(html).not.toMatch(/onerror|<script|javascript:/i);
  });
});

describe("User-entered links", () => {
  const BAD = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd"];

  it("website links (social, map, team LinkedIn) keep only http(s)", () => {
    for (const u of BAD) expect(() => cleanUrl(u, "The link")).toThrow();
    expect(cleanUrl("example.com/page", "The link")).toBe("https://example.com/page");
  });

  it("link lessons keep only http(s)", () => {
    for (const u of BAD) expect(normaliseLink(u)).toBeNull();
    expect(normaliseLink("https://docs.python.org/3/")).toBe("https://docs.python.org/3/");
  });

  it("meeting and recording links keep only http(s)", () => {
    for (const u of BAD) expect(safeMeetingUrl(u)).toBeNull();
    expect(safeMeetingUrl("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("React blocks a javascript: href that reaches it anyway", () => {
    const html = renderToStaticMarkup(<a href={"javascript:alert(1)"}>x</a>);
    expect(html).not.toContain("javascript:alert(1)");
  });
});

describe("Emails", () => {
  it("template text is escaped, so a template can't add markup", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    const html = textToHtml(`Hi <b>there</b> "you" & https://example.com/a?b=<x>`, "#0B5E4C");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("the demo request email (filled in by anyone on the website) escapes every field", () => {
    const evil = `<a href="https://evil.test">Click</a>`;
    const { html } = demoRequestEmail(
      { name: evil, institute: evil, role: evil, phone: "9820012345", email: "a@b.test", city: evil, message: evil } as Parameters<typeof demoRequestEmail>[0],
      null,
    );
    expect(html).not.toContain('<a href="https://evil.test">');
    expect(html).toContain("&lt;a href=&quot;https://evil.test&quot;&gt;");
  });
});

describe("Redirect after sign-in (?next=)", () => {
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "/\t/evil.test",
    "/%0a/evil.test".replace("%0a", "\n"),
    "javascript:alert(1)",
    "http:/evil.test",
    `/${"a".repeat(600)}`,
  ])("refuses %s", (next) => {
    expect(safeNext(next)).toBeNull();
  });

  it("keeps a page on Zinny", () => {
    expect(safeNext("/demo/learn/timetable?week=2026-11-23")).toBe("/demo/learn/timetable?week=2026-11-23");
    expect(safeNext("/marketplace")).toBe("/marketplace");
  });
});
