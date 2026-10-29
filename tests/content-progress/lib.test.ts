import { describe, expect, it } from "vitest";
import { partCount, partLength, safeFileName, sniffType, PART_SIZE } from "@/modules/content-progress/lib/files";
import { coursePercent, describeDrip, embedUrl, hasContent, isLocked, normaliseLink, parseVideoUrl, readContent, unlockDate } from "@/modules/content-progress/lib/kinds";
import { makePdf } from "@/modules/content-progress/lib/pdf";
import { addWatched, mergeRanges, reachedCompletion, watchedPercent, watchedSeconds } from "@/modules/content-progress/lib/ranges";
import { sanitizeLessonHtml, textLength } from "@/modules/content-progress/lib/sanitize";

describe("course percentage", () => {
  it("is completed required lessons ÷ required lessons, rounded down", () => {
    expect(coursePercent(0, 3)).toBe(0);
    expect(coursePercent(1, 3)).toBe(33);
    expect(coursePercent(2, 3)).toBe(66);
    expect(coursePercent(3, 3)).toBe(100);
    expect(coursePercent(10, 11)).toBe(90);
  });
  it("is 0 when a course has no required lessons, and never above 100", () => {
    expect(coursePercent(0, 0)).toBe(0);
    expect(coursePercent(5, 4)).toBe(100);
  });
});

describe("drip", () => {
  const none = { dripMode: "none" as const, dripDays: null, dripDate: null };
  it("opens N days after the student's batch starts", () => {
    const l = { dripMode: "after_start" as const, dripDays: 7, dripDate: null };
    expect(unlockDate(l, "2026-11-02")).toBe("2026-11-09");
    expect(isLocked(unlockDate(l, "2026-11-02"), "2026-11-08")).toBe(true);
    expect(isLocked(unlockDate(l, "2026-11-02"), "2026-11-09")).toBe(false);
    expect(describeDrip(l)).toBe("Opens 7 days after the batch starts");
  });
  it("opens on a fixed date whatever the batch", () => {
    const l = { dripMode: "on_date" as const, dripDays: null, dripDate: "2026-12-01" };
    expect(unlockDate(l, "2026-01-01")).toBe("2026-12-01");
    expect(isLocked("2026-12-01", "2026-11-30")).toBe(true);
    expect(isLocked("2026-12-01", "2026-12-01")).toBe(false);
  });
  it("lessons without drip are open from enrolment", () => {
    expect(unlockDate(none, "2030-01-01")).toBeNull();
    expect(isLocked(null, "2026-01-01")).toBe(false);
    expect(describeDrip(none)).toBeNull();
  });
});

describe("video links", () => {
  it.each([
    ["https://www.youtube.com/watch?v=kqtD5dpn9C8", "youtube", "kqtD5dpn9C8"],
    ["https://youtu.be/kqtD5dpn9C8?t=30", "youtube", "kqtD5dpn9C8"],
    ["https://m.youtube.com/watch?v=kqtD5dpn9C8&list=x", "youtube", "kqtD5dpn9C8"],
    ["https://www.youtube.com/shorts/kqtD5dpn9C8", "youtube", "kqtD5dpn9C8"],
    ["https://www.youtube-nocookie.com/embed/kqtD5dpn9C8", "youtube", "kqtD5dpn9C8"],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://player.vimeo.com/video/76979871?h=abc123def", "vimeo", "76979871"],
    ["https://vimeo.com/channels/staffpicks/76979871", "vimeo", "76979871"],
  ])("understands %s", (url, source, id) => {
    expect(parseVideoUrl(url)).toMatchObject({ source, videoId: id });
  });
  it("keeps the hash of unlisted Vimeo videos", () => {
    const v = parseVideoUrl("https://vimeo.com/76979871/abc123def")!;
    expect(v.hash).toBe("abc123def");
    expect(embedUrl(v)).toContain("h=abc123def");
  });
  it.each(["https://example.com/watch?v=kqtD5dpn9C8", "javascript:alert(1)", "https://www.youtube.com/watch?v=short", "not a url", "https://vimeo.com/about"])(
    "refuses %s",
    (url) => expect(parseVideoUrl(url)).toBeNull(),
  );
  it("embeds YouTube without cookies", () => {
    expect(embedUrl(parseVideoUrl("https://youtu.be/kqtD5dpn9C8")!)).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/kqtD5dpn9C8/);
  });
});

describe("link lessons", () => {
  it("only take http(s) addresses", () => {
    expect(normaliseLink("https://sqlbolt.com")).toBe("https://sqlbolt.com/");
    expect(normaliseLink("javascript:alert(1)")).toBeNull();
    expect(normaliseLink("data:text/html,hi")).toBeNull();
    expect(normaliseLink("https://localhost")).toBeNull();
  });
});

describe("lesson content", () => {
  it("knows when a lesson has what it needs", () => {
    expect(hasContent("live", {})).toBe(true);
    expect(hasContent("text", { html: "<p> </p>" })).toBe(false);
    expect(hasContent("text", { html: "<p>Hi</p>" })).toBe(true);
    expect(hasContent("video", { source: "youtube", videoId: "kqtD5dpn9C8" })).toBe(true);
    expect(hasContent("video", { source: "upload" })).toBe(false);
    expect(hasContent("pdf", { key: "k", fileName: "a.pdf" })).toBe(true);
    expect(hasContent("link", {})).toBe(false);
  });
  it("reads malformed content as empty", () => {
    expect(readContent("video", { source: "youtube", videoId: 5 })).toEqual({ kind: "video", video: null });
    expect(readContent("text", null)).toEqual({ kind: "text", html: "" });
  });
});

describe("text lessons are sanitised", () => {
  it("removes scripts, event handlers, styles and dangerous links", () => {
    const dirty =
      '<h1>Title</h1><p onclick="steal()">Hi <script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a> ' +
      '<a href="https://ok.example">ok</a></p><iframe src="https://evil"></iframe><style>body{}</style><p style="color:red">x</p>';
    const clean = sanitizeLessonHtml(dirty);
    expect(clean).not.toMatch(/script|onerror|onclick|javascript:|iframe|style|<img/i);
    expect(clean).toContain("<h2>Title</h2>");
    expect(clean).toContain('<a href="https://ok.example" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
    expect(clean).toContain("<a>bad</a>");
  });
  it("keeps the formatting the editor makes", () => {
    const html = "<h2>A</h2><h3>B</h3><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p><ul><li>x</li></ul><ol start=\"3\"><li>y</li></ol><blockquote><p>q</p></blockquote><pre><code>z</code></pre><hr>";
    expect(sanitizeLessonHtml(html)).toBe(html.replace("<hr>", "<hr />"));
  });
  it("measures the visible text", () => {
    expect(textLength("<p>  </p><p><br></p>")).toBe(0);
    expect(textLength("<p>Hello <b>there</b></p>")).toBe(11);
  });
});

describe("watched parts of a video", () => {
  it("merges overlapping and touching ranges", () => {
    expect(mergeRanges([[10, 20], [0, 5], [19, 30], [31, 40]], 100)).toEqual([[0, 5], [10, 40]]);
    expect(mergeRanges([[-5, 3], [90, 200], [50, 40]], 100)).toEqual([[0, 3], [90, 100]]);
  });
  it("counts rewatching once", () => {
    const a = addWatched([[0, 50]], [[0, 50], [40, 60]], 100, 1000);
    expect(a.watched).toBe(60);
    expect(a.added).toBe(10);
  });
  it("never adds more new time than really passed", () => {
    const forged = addWatched([], [[0, 600]], 600, 25);
    expect(forged.watched).toBe(25);
    const later = addWatched(forged.ranges, [[0, 600]], 600, 25);
    expect(later.watched).toBe(50);
  });
  it("completes at 90%", () => {
    expect(reachedCompletion(89.9, 100)).toBe(false);
    expect(reachedCompletion(90, 100)).toBe(true);
    expect(watchedPercent(45, 60)).toBe(75);
    expect(watchedSeconds([[0, 10], [20, 25]])).toBe(15);
  });
});

describe("uploads", () => {
  it("splits files into parts of at most 4 MB", () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(PART_SIZE)).toBe(1);
    expect(partCount(PART_SIZE + 1)).toBe(2);
    expect(partLength(PART_SIZE + 10, 0)).toBe(PART_SIZE);
    expect(partLength(PART_SIZE + 10, 1)).toBe(10);
    expect(partLength(PART_SIZE + 10, 2)).toBe(0);
  });
  it("reads the real type from the first bytes", () => {
    expect(sniffType("pdf", Buffer.from("%PDF-1.4 rest"))).toBe("application/pdf");
    expect(sniffType("pdf", Buffer.from("<html>"))).toBeNull();
    expect(sniffType("video", Buffer.from([0, 0, 0, 0x20, ...Buffer.from("ftypisom")]))).toBe("video/mp4");
    expect(sniffType("video", Buffer.from([0, 0, 0, 0x14, ...Buffer.from("ftypqt  ")]))).toBe("video/quicktime");
    expect(sniffType("video", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe("video/webm");
    expect(sniffType("video", Buffer.from("%PDF-1.4"))).toBeNull();
  });
  it("makes file names safe for storage keys", () => {
    expect(safeFileName("Week 1 notes (final).pdf", "x.pdf")).toBe("Week 1 notes (final).pdf");
    expect(safeFileName("../../etc/passwd", "x.pdf")).toBe("passwd");
    expect(safeFileName("résumé ✓.pdf", "x.pdf")).toBe("resume -.pdf");
    expect(safeFileName("..", "x.pdf")).toBe("x.pdf");
  });
});

describe("seed PDFs", () => {
  it("are valid PDF files with a cross-reference table", () => {
    const pdf = makePdf("Handbook", [{ heading: "Hello", text: "A ".repeat(3000) }], "Footer").toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    expect(Number(pdf.match(/\/Count (\d+)/)![1])).toBeGreaterThan(1);
  });
});
