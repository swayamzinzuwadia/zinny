/**
 * The three certificate designs, all A4 landscape, all built from the university's name,
 * logo (or a monogram when there is none) and brand colour.
 *
 *   classic  cream paper, double border, serif type, everything centred
 *   modern   a band in the brand colour down the left, Lexend type, left aligned
 *   minimal  white page, thin brand bar, serif heading, quiet layout
 */
import type { FontKey } from "./fonts";
import {
  GOLD,
  INK,
  LINE,
  MUTED,
  PAGE,
  PAPER,
  WHITE,
  fitBlock,
  fitImage,
  fitLine,
  initials,
  longDate,
  luminance,
  qrPath,
  roundedRect,
  type CertificateContent,
  type DesignContext,
  type Prim,
  type Scene,
} from "./scene";

const W = PAGE.width;
const H = PAGE.height;

export const DESIGNS = {
  classic: { label: "Classic", description: "Cream paper, a double border and serif type, centred." },
  modern: { label: "Modern", description: "A band in your brand colour down the left, clean Lexend type." },
  minimal: { label: "Minimal", description: "A white page with a thin brand bar and a quiet layout." },
} as const;

export type DesignKey = keyof typeof DESIGNS;

function verifyHost(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}/verify`;
  } catch {
    return "the verify page";
  }
}

function text(x: number, y: number, s: string, font: FontKey, size: number, color: string, align: "left" | "center" | "right" = "left", opacity?: number): Prim {
  return { t: "text", x, y, text: s, font, size, color, align, ...(opacity !== undefined && { opacity }) };
}

function diamond(cx: number, cy: number, r: number, fill: string): Prim {
  return { t: "path", d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`, fill };
}

/** Course title over up to two lines; returns the primitives and the last baseline. */
function courseBlock(ctx: DesignContext, c: CertificateContent, o: { x: number; y: number; font: FontKey; max: number; min: number; maxWidth: number; color: string; align: "left" | "center" }) {
  const { size, lines } = fitBlock(ctx.measure, o.font, c.courseTitle, { max: o.max, min: o.min, maxWidth: o.maxWidth, maxLines: 2 });
  const lh = size * 1.3;
  return { prims: lines.map((l, i) => text(o.x, o.y + i * lh, l, o.font, size, o.color, o.align)), last: o.y + (lines.length - 1) * lh };
}

/**
 * The student's name: shrinks to fit, then wraps to a second line rather than being cut.
 * Returns the primitives and how far it pushed the rest of the page down.
 */
function nameBlock(ctx: DesignContext, c: CertificateContent, o: { x: number; y: number; font: FontKey; max: number; min: number; maxWidth: number; color: string; align: "left" | "center" }) {
  const one = fitBlock(ctx.measure, o.font, c.studentName, { max: o.max, min: o.min, maxWidth: o.maxWidth, maxLines: 1 });
  const fits = ctx.measure(o.font, one.lines[0], one.size) <= o.maxWidth && !one.lines[0].endsWith("…");
  const { size, lines } = fits ? one : fitBlock(ctx.measure, o.font, c.studentName, { max: o.min, min: o.min * 0.75, maxWidth: o.maxWidth, maxLines: 2 });
  const lh = size * 1.18;
  return { prims: lines.map((l, i) => text(o.x, o.y + i * lh, l, o.font, size, o.color, o.align)), extra: (lines.length - 1) * lh };
}

/** A signatory: signature image above a line, then name and title. `x` is the centre (centred) or left edge. */
function signatory(
  ctx: DesignContext,
  s: CertificateContent["signatories"][number],
  o: { x: number; lineY: number; width: number; align: "left" | "center"; line?: { color: string; opacity?: number } },
): Prim[] {
  const out: Prim[] = [];
  const left = o.align === "center" ? o.x - o.width / 2 : o.x;
  if (s.image) out.push(fitImage(s.image, { x: left, y: o.lineY - 46, w: o.width, h: 42 }, o.align));
  if (o.line) out.push({ t: "line", x1: left, y1: o.lineY, x2: left + o.width, y2: o.lineY, stroke: o.line.color, sw: 0.6, opacity: o.line.opacity });
  const name = fitLine(ctx.measure, "sansBold", s.name, { max: 10, min: 7.5, maxWidth: o.width + 20 });
  const title = fitLine(ctx.measure, "sansLight", s.title, { max: 8.5, min: 6.5, maxWidth: o.width + 20 });
  out.push(text(o.x, o.lineY + 15, name.text, "sansBold", name.size, INK, o.align));
  if (s.title) out.push(text(o.x, o.lineY + 27, title.text, "sansLight", title.size, MUTED, o.align));
  return out;
}

function logoOrMonogram(c: CertificateContent, box: { x: number; y: number; w: number; h: number }, mono: { fill: string; color: string; font: FontKey; circle: boolean }): Prim[] {
  if (c.logo) return [fitImage(c.logo, box, "center", "middle")];
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.min(box.w, box.h) / 2;
  const letters = initials(c.universityName);
  const size = r * (letters.length > 2 ? 0.62 : 0.78);
  return [
    ...(mono.circle ? [{ t: "circle", cx, cy, r, fill: mono.fill } as Prim] : []),
    text(cx, cy + size * 0.36, letters, mono.font, size, mono.color, "center"),
  ];
}

const signers = (c: CertificateContent) => c.signatories.filter((s) => s.name.trim()).slice(0, 2);

/* ─────────────────────────── Classic ─────────────────────────── */

function classic(c: CertificateContent, ctx: DesignContext): Scene {
  const a = c.accentColor;
  const p: Prim[] = [
    { t: "rect", x: 20, y: 20, w: W - 40, h: H - 40, stroke: a, sw: 2 },
    { t: "rect", x: 28, y: 28, w: W - 56, h: H - 56, stroke: a, sw: 0.6 },
    diamond(28, 28, 5, GOLD),
    diamond(W - 28, 28, 5, GOLD),
    diamond(28, H - 28, 5, GOLD),
    diamond(W - 28, H - 28, 5, GOLD),
  ];
  p.push(...logoOrMonogram(c, { x: W / 2 - 30, y: 50, w: 60, h: 60 }, { fill: a, color: luminance(a) > 0.45 ? INK : WHITE, font: "serifBold", circle: true }));

  const uni = fitLine(ctx.measure, "serifBold", c.universityName, { max: 15, min: 10, maxWidth: 620 });
  p.push(text(W / 2, 136, uni.text, "serifBold", uni.size, a, "center"));
  const heading = fitLine(ctx.measure, "serif", c.heading, { max: 34, min: 20, maxWidth: 660 });
  p.push(text(W / 2, 184, heading.text, "serif", heading.size, INK, "center"));
  p.push(
    { t: "line", x1: W / 2 - 46, y1: 202, x2: W / 2 - 9, y2: 202, stroke: GOLD, sw: 0.8 },
    diamond(W / 2, 202, 3.5, GOLD),
    { t: "line", x1: W / 2 + 9, y1: 202, x2: W / 2 + 46, y2: 202, stroke: GOLD, sw: 0.8 },
  );
  const intro = fitLine(ctx.measure, "sansLight", c.intro, { max: 12, min: 9, maxWidth: 600 });
  p.push(text(W / 2, 236, intro.text, "sansLight", intro.size, MUTED, "center"));
  const name = nameBlock(ctx, c, { x: W / 2, y: 282, font: "serifItalic", max: 36, min: 18, maxWidth: 600, color: INK, align: "center" });
  const dy = name.extra;
  p.push(...name.prims);
  p.push({ t: "line", x1: W / 2 - 220, y1: 297 + dy, x2: W / 2 + 220, y2: 297 + dy, stroke: GOLD, sw: 0.8 });
  const body = fitLine(ctx.measure, "sansLight", c.body, { max: 12, min: 9, maxWidth: 600 });
  p.push(text(W / 2, 324 + dy, body.text, "sansLight", body.size, MUTED, "center"));
  const course = courseBlock(ctx, c, { x: W / 2, y: 356 + dy, font: "serifBold", max: dy ? 17 : 21, min: 13, maxWidth: 640, color: a, align: "center" });
  p.push(...course.prims);
  p.push(text(W / 2, Math.min(course.last + 24, 424), `on ${longDate(c.completedOn)}`, "sansLight", 11, MUTED, "center"));

  // Bottom row: signatories either side, the QR code between them.
  const s = signers(c);
  const qrCx = s.length === 1 ? 210 : W / 2;
  const qrSize = 60;
  p.push({ t: "qr", x: qrCx - qrSize / 2, y: 432, size: qrSize, matrix: ctx.qr, color: INK });
  p.push(text(qrCx, 505, c.code, "sansBold", 8.5, INK, "center"));
  p.push(text(qrCx, 516, `Verify at ${verifyHost(c.verifyUrl)}`, "sansLight", 7, MUTED, "center"));
  if (c.validUntil) p.push(text(qrCx, 527, `Valid until ${longDate(c.validUntil)}`, "sansLight", 7, MUTED, "center"));
  const xs = s.length === 2 ? [210, W - 210] : [W - 210];
  s.forEach((sig, i) => p.push(...signatory(ctx, sig, { x: xs[i], lineY: 490, width: 160, align: "center", line: { color: INK, opacity: 0.45 } })));

  return { width: W, height: H, background: PAPER, prims: p };
}

/* ─────────────────────────── Modern ─────────────────────────── */

function modern(c: CertificateContent, ctx: DesignContext): Scene {
  const a = c.accentColor;
  const on = luminance(a) > 0.45 ? INK : WHITE;
  const band = 236;
  const p: Prim[] = [{ t: "rect", x: 0, y: 0, w: band, h: H, fill: a }];

  p.push({ t: "path", d: roundedRect(40, 48, 76, 76, 16), fill: WHITE });
  p.push(...logoOrMonogram(c, { x: 48, y: 56, w: 60, h: 60 }, { fill: WHITE, color: a, font: "sansBold", circle: false }));
  const uni = fitBlock(ctx.measure, "sansBold", c.universityName, { max: 15, min: 10, maxWidth: band - 76, maxLines: 3 });
  uni.lines.forEach((l, i) => p.push(text(40, 160 + i * uni.size * 1.3, l, "sansBold", uni.size, on)));

  p.push({ t: "path", d: roundedRect(40, 382, 96, 96, 12), fill: WHITE });
  p.push({ t: "qr", x: 48, y: 390, size: 80, matrix: ctx.qr, color: INK });
  p.push(text(40, 504, "Certificate code", "sansLight", 8.5, on, "left", 0.8));
  p.push(text(40, 520, c.code, "sansBold", 12, on));
  const host = fitLine(ctx.measure, "sansLight", `Verify at ${verifyHost(c.verifyUrl)}`, { max: 8, min: 6, maxWidth: band - 60 });
  p.push(text(40, 536, host.text, "sansLight", host.size, on, "left", 0.8));

  const x = 290;
  const mw = W - x - 52;
  p.push({ t: "rect", x, y: 72, w: 36, h: 3, fill: a });
  const heading = fitLine(ctx.measure, "sansBold", c.heading, { max: 14, min: 10, maxWidth: mw });
  p.push(text(x, 98, heading.text, "sansBold", heading.size, a));
  const intro = fitLine(ctx.measure, "sansLight", c.intro, { max: 12.5, min: 9, maxWidth: mw });
  p.push(text(x, 162, intro.text, "sansLight", intro.size, MUTED));
  const name = nameBlock(ctx, c, { x, y: 212, font: "sansBold", max: 42, min: 22, maxWidth: mw, color: INK, align: "left" });
  const dy = name.extra;
  p.push(...name.prims);
  const body = fitLine(ctx.measure, "sansLight", c.body, { max: 13, min: 9, maxWidth: mw });
  p.push(text(x, 252 + dy, body.text, "sansLight", body.size, MUTED));
  const course = courseBlock(ctx, c, { x, y: 290 + dy, font: "sansBold", max: 24, min: 14, maxWidth: mw, color: a, align: "left" });
  p.push(...course.prims);
  const when = `Completed on ${longDate(c.completedOn)}${c.validUntil ? `  ·  Valid until ${longDate(c.validUntil)}` : ""}`;
  p.push(text(x, Math.min(course.last + 28, 420), when, "sans", 11, MUTED));

  signers(c).forEach((sig, i) => p.push(...signatory(ctx, sig, { x: x + i * 250, lineY: 488, width: 180, align: "left", line: { color: INK, opacity: 0.35 } })));
  return { width: W, height: H, background: WHITE, prims: p };
}

/* ─────────────────────────── Minimal ─────────────────────────── */

function minimal(c: CertificateContent, ctx: DesignContext): Scene {
  const a = c.accentColor;
  const x = 64;
  const mw = W - 2 * x;
  const p: Prim[] = [{ t: "rect", x: 0, y: 0, w: W, h: 6, fill: a }];

  p.push(...logoOrMonogram(c, { x, y: 48, w: 44, h: 44 }, { fill: a, color: luminance(a) > 0.45 ? INK : WHITE, font: "sansBold", circle: true }));
  const uni = fitLine(ctx.measure, "sansBold", c.universityName, { max: 14, min: 9, maxWidth: 440 });
  p.push(text(x + 58, 75, uni.text, "sansBold", uni.size, INK));
  p.push(text(W - x, 64, "Certificate code", "sansLight", 8, MUTED, "right"));
  p.push(text(W - x, 80, c.code, "sansBold", 11, INK, "right"));

  const heading = fitLine(ctx.measure, "serif", c.heading, { max: 40, min: 22, maxWidth: mw });
  p.push(text(x, 196, heading.text, "serif", heading.size, INK));
  const intro = fitLine(ctx.measure, "sansLight", c.intro, { max: 12, min: 9, maxWidth: mw });
  p.push(text(x, 244, intro.text, "sansLight", intro.size, MUTED));
  const name = nameBlock(ctx, c, { x, y: 290, font: "serifBold", max: 34, min: 18, maxWidth: mw, color: a, align: "left" });
  const dy = name.extra;
  p.push(...name.prims);
  const body = fitLine(ctx.measure, "sansLight", c.body, { max: 12, min: 9, maxWidth: mw });
  p.push(text(x, 328 + dy, body.text, "sansLight", body.size, MUTED));
  const course = courseBlock(ctx, c, { x, y: 362 + dy, font: "sansBold", max: dy ? 17 : 20, min: 13, maxWidth: mw, color: INK, align: "left" });
  p.push(...course.prims);
  const when = `Completed on ${longDate(c.completedOn)}${c.validUntil ? `  ·  Valid until ${longDate(c.validUntil)}` : ""}`;
  p.push(text(x, Math.min(course.last + 26, 424), when, "sans", 11, MUTED));

  p.push({ t: "line", x1: x, y1: 440, x2: W - x, y2: 440, stroke: LINE, sw: 0.8 });
  signers(c).forEach((sig, i) => p.push(...signatory(ctx, sig, { x: x + i * 250, lineY: 496, width: 170, align: "left" })));
  p.push({ t: "qr", x: W - x - 64, y: 456, size: 64, matrix: ctx.qr, color: INK });
  p.push(text(W - x - 76, 492, "Scan to verify", "sansLight", 8, MUTED, "right"));
  const host = fitLine(ctx.measure, "sansLight", verifyHost(c.verifyUrl), { max: 7.5, min: 6, maxWidth: 160 });
  p.push(text(W - x - 76, 504, host.text, "sansLight", host.size, MUTED, "right"));
  return { width: W, height: H, background: WHITE, prims: p };
}

export function buildScene(c: CertificateContent, ctx: DesignContext): Scene {
  switch (c.design) {
    case "classic":
      return classic(c, ctx);
    case "modern":
      return modern(c, ctx);
    case "minimal":
      return minimal(c, ctx);
  }
}
