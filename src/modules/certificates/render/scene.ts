/**
 * A certificate page as a list of drawing primitives. Each design builds a scene; the PDF
 * and SVG renderers draw the same scene, so the live preview matches the PDF.
 *
 * Coordinates are PDF points with the origin at the top left (y grows downwards).
 * Text `y` is the baseline. Colours are "#rrggbb".
 */
import type { FontKey, Measure } from "./fonts";

/** A4 landscape. */
export const PAGE = { width: 841.89, height: 595.28 } as const;

export type ImageAsset = { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number };

export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean };

export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; opacity?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; opacity?: number }
  /** An SVG path in page coordinates. */
  | { t: "path"; d: string; fill?: string; stroke?: string; sw?: number; opacity?: number }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; opacity?: number }
  | { t: "text"; x: number; y: number; text: string; font: FontKey; size: number; color: string; align: "left" | "center" | "right"; opacity?: number }
  | { t: "image"; x: number; y: number; w: number; h: number; image: ImageAsset }
  | { t: "qr"; x: number; y: number; size: number; matrix: QrMatrix; color: string };

export type Scene = { width: number; height: number; background: string; prims: Prim[] };

/** Everything a design needs to draw one certificate. */
export type CertificateContent = {
  design: "classic" | "modern" | "minimal";
  universityName: string;
  logo: ImageAsset | null;
  accentColor: string;
  heading: string;
  intro: string;
  body: string;
  studentName: string;
  courseTitle: string;
  /** "YYYY-MM-DD" */
  completedOn: string;
  validUntil: string | null;
  /** Display form, "7K3P-9QXA-M2D4". */
  code: string;
  verifyUrl: string;
  signatories: { name: string; title: string; image: ImageAsset | null }[];
};

export type DesignContext = { measure: Measure; qr: QrMatrix };

/* ─────────────────────────── Colours ─────────────────────────── */

export const INK = "#14261f";
export const MUTED = "#5d6b64";
export const FAINT = "#98a39d";
export const LINE = "#e8e0cc";
export const GOLD = "#d4a72a";
export const PAPER = "#fffdf7";
export const WHITE = "#ffffff";
export const ZINNY_GREEN = "#0b5e4c";

/** The university's brand colour if it is a usable hex colour, otherwise Zinny green. */
export function accentFrom(primaryColor: string | undefined | null): string {
  const c = (primaryColor ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join("")}`;
  return ZINNY_GREEN;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = accentFrom(hex);
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}

/** Mixes a colour with white: `amount` 0 = the colour, 1 = white. */
export function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (v: number) => Math.round((v + (1 - v) * amount) * 255);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance, for picking readable text on the accent colour. */
export function luminance(hex: string): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* ─────────────────────────── Text ─────────────────────────── */

/** Greedy word wrap. A single word wider than the line stays on its own line. */
export function wrap(measure: Measure, font: FontKey, size: number, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(font, next, size) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/**
 * The largest size from `max` down to `min` at which `text` fits in `maxLines` lines of
 * `maxWidth`. At `min` it still doesn't fit, the last line is cut with an ellipsis.
 */
export function fitBlock(
  measure: Measure,
  font: FontKey,
  text: string,
  o: { max: number; min: number; maxWidth: number; maxLines: number },
): { size: number; lines: string[] } {
  for (let size = o.max; size >= o.min; size -= 0.5) {
    const lines = wrap(measure, font, size, text, o.maxWidth);
    if (lines.length <= o.maxLines && lines.every((l) => measure(font, l, size) <= o.maxWidth)) return { size, lines };
  }
  const size = o.min;
  const lines = wrap(measure, font, size, text, o.maxWidth).slice(0, o.maxLines);
  const last = lines.length - 1;
  lines[last] = ellipsize(measure, font, size, lines[last], o.maxWidth, lines.length < wrap(measure, font, size, text, o.maxWidth).length);
  return { size, lines };
}

function ellipsize(measure: Measure, font: FontKey, size: number, text: string, maxWidth: number, force: boolean) {
  if (!force && measure(font, text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && measure(font, `${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** One line of text, shrunk between `max` and `min` to fit `maxWidth`, then cut with an ellipsis. */
export function fitLine(measure: Measure, font: FontKey, text: string, o: { max: number; min: number; maxWidth: number }) {
  const r = fitBlock(measure, font, text, { ...o, maxLines: 1 });
  return { size: r.size, text: r.lines[0] };
}

/** "2026-10-12" → "12 October 2026". */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

/** Initials for the monogram shown when a university has no usable logo. */
export function initials(name: string): string {
  const skip = new Set(["of", "the", "and", "for", "&", "in", "at"]);
  const words = name.split(/\s+/).filter((w) => w && !skip.has(w.toLowerCase()));
  return (words.length >= 2 ? words.slice(0, 3).map((w) => w[0]) : [...(words[0] ?? "Z")].slice(0, 2)).join("").toUpperCase();
}

/** Fits an image inside a box, keeping its proportions. `align` places it horizontally; it sits on the box's bottom edge. */
export function fitImage(image: ImageAsset, box: { x: number; y: number; w: number; h: number }, align: "left" | "center" = "center", valign: "bottom" | "middle" = "bottom"): Prim {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const x = align === "center" ? box.x + (box.w - w) / 2 : box.x;
  const y = valign === "bottom" ? box.y + box.h - h : box.y + (box.h - h) / 2;
  return { t: "image", x, y, w, h, image };
}

/** A rounded rectangle as an SVG path. */
export function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, h / 2);
  return [
    `M${x + k} ${y}`,
    `H${x + w - k}`,
    `A${k} ${k} 0 0 1 ${x + w} ${y + k}`,
    `V${y + h - k}`,
    `A${k} ${k} 0 0 1 ${x + w - k} ${y + h}`,
    `H${x + k}`,
    `A${k} ${k} 0 0 1 ${x} ${y + h - k}`,
    `V${y + k}`,
    `A${k} ${k} 0 0 1 ${x + k} ${y}`,
    "Z",
  ].join(" ");
}

/** The QR code as one path: a rectangle per run of dark modules in each row. */
export function qrPath(m: QrMatrix, x: number, y: number, size: number): string {
  const cell = size / m.size;
  const parts: string[] = [];
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < m.size && m.dark(r, c)) c++;
      const px = +(x + start * cell).toFixed(3);
      const py = +(y + r * cell).toFixed(3);
      // A hair of overlap so neighbouring rows don't show seams when rasterised.
      parts.push(`M${px} ${py}h${+((c - start) * cell).toFixed(3)}v${+(cell + 0.05).toFixed(3)}h${-+((c - start) * cell).toFixed(3)}Z`);
    }
  }
  return parts.join("");
}
