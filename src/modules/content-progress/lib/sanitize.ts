/**
 * Rich text for text lessons. Staff write it in the editor; it is sanitised when saved and
 * again when shown, so a stored script, event handler or javascript: link never reaches a
 * student's browser. Server only (sanitize-html runs on Node).
 */
import "server-only";
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "a",
    "ul", "ol", "li", "blockquote", "code", "pre", "hr",
  ],
  allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // h1 is the page title; editors' h1 becomes h2.
  transformTags: {
    h1: "h2",
    // Links open in a new tab. A link to anything but http(s) or mailto keeps its text and loses the link.
    a: (tagName, attribs) => {
      const href = (attribs.href ?? "").trim();
      const out: sanitizeHtml.Attributes = /^(https?:\/\/|mailto:)/i.test(href) ? { href, target: "_blank", rel: "noopener noreferrer nofollow" } : {};
      return { tagName, attribs: out };
    },
  },
};

/** At most this much HTML per lesson (about 100 pages of text). */
export const MAX_TEXT_HTML = 200_000;

export function sanitizeLessonHtml(html: string): string {
  return sanitizeHtml(html ?? "", OPTIONS).trim();
}

/** Plain text length, for "the lesson is empty" checks. */
export function textLength(html: string): number {
  return sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim().length;
}
