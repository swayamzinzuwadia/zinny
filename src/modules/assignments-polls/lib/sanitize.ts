/**
 * Assignment instructions are rich text written in the browser. Only a small, safe set of
 * tags is kept: no scripts, styles, images, iframes, event handlers or javascript: links.
 * Stored sanitised, and sanitised again when shown.
 */
import sanitizeHtml from "sanitize-html";

export const MAX_INSTRUCTIONS_CHARS = 50_000;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "s", "h3", "h4", "ul", "ol", "li", "a", "blockquote", "code", "pre", "hr"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Whatever the editor or a paste produces, map it onto the allowed tags.
  transformTags: {
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    div: "p",
    h1: "h3",
    h2: "h3",
    h5: "h4",
    h6: "h4",
    a: (tagName, attribs) => ({
      tagName,
      attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
  },
  exclusiveFilter: (frame) => frame.tag === "a" && !frame.attribs.href,
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head"],
};

/** Safe HTML for instructions. Returns "" when nothing readable is left. */
export function sanitizeInstructions(html: string): string {
  const clean = sanitizeHtml(html ?? "", OPTIONS)
    .replace(/<p>(\s|&nbsp;|<br \/>)*<\/p>/g, "")
    .trim();
  return plainText(clean) ? clean : "";
}

/** The text of some HTML, for previews and notifications. */
export function plainText(html: string): string {
  return sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
