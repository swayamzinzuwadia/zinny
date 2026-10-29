/**
 * Blog HTML is sanitised on every save, with an allow-list: headings, paragraphs, lists,
 * quotes, code, emphasis and links. Everything else (scripts, styles, iframes, images,
 * event handlers, classes, inline styles, unsafe link schemes) is removed. Unsafe links
 * become plain text; external links get rel="noopener noreferrer nofollow" and open in a new tab.
 */
import sanitizeHtml from "sanitize-html";

/** http(s), mailto and tel links, and links within the site ("/…" or "#…"). */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

/**
 * Marker for links to unwrap. (Renaming a tag to one that is then discarded confuses
 * sanitize-html's closing tags, so unsafe links are renamed to this allowed marker and
 * the marker is stripped afterwards.)
 */
const UNWRAP = "zinny-unwrap";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "h2", "h3", "strong", "em", "u", "s", "a", "ul", "ol", "li", "blockquote", "hr", "code", "pre", UNWRAP],
  allowedAttributes: { a: ["href", "title", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Contents of these are dropped entirely, not kept as text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "svg", "math", "template"],
  transformTags: {
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    div: "p",
    a: (_tag, attribs) => {
      const href = (attribs.href ?? "").trim();
      // Unsafe or empty links become plain text: marked here, unwrapped after sanitising.
      if (!SAFE_HREF.test(href)) return { tagName: UNWRAP, attribs: {} };
      const external = /^https?:/i.test(href);
      return {
        tagName: "a",
        attribs: {
          href,
          ...(attribs.title ? { title: attribs.title } : {}),
          ...(external ? { rel: "noopener noreferrer nofollow", target: "_blank" } : {}),
        },
      };
    },
  },
};

export function sanitizeBlogHtml(html: string): string {
  const clean = sanitizeHtml(html ?? "", OPTIONS)
    .replace(new RegExp(`</?${UNWRAP}>`, "g"), "")
    // Drop empty paragraphs the editor leaves at the end.
    .replace(/(<p>\s*(<br \/>)?\s*<\/p>\s*)+$/g, "")
    .trim();
  return clean;
}

/** The plain text of some HTML, whitespace collapsed (entities decoded). */
export function textOf(html: string): string {
  const text = sanitizeHtml(html.replace(/<\/(p|h2|h3|li|blockquote|pre)>/g, " $&").replace(/<br\s*\/?>/g, " "), {
    allowedTags: [],
    allowedAttributes: {},
  });
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minutes to read at about 200 words a minute (at least 1). */
export function readingMinutes(html: string): number {
  const words = textOf(html).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
