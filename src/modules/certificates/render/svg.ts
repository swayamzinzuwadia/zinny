/**
 * Draws a scene as an SVG string, for the live preview and on-screen certificates.
 * Text uses the same font files as the PDF (served from /verify/fonts) with kerning off,
 * which is how pdf-lib sets text, so lines break and fit the same way.
 * Every piece of text is escaped; images are inlined as data URIs.
 */
import { FONT_FILES, FONT_KEYS, fontFamily, type FontKey } from "./fonts";
import { dataUri } from "./images";
import { qrPath, type Scene } from "./scene";

export const FONT_ROUTE = "/verify/fonts";

const n = (v: number) => String(Math.round(v * 100) / 100);

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** @font-face rules for the certificate fonts (safe to repeat on a page). */
export function fontFaceCss(used: readonly FontKey[] = FONT_KEYS): string {
  return used
    .map((k) => `@font-face{font-family:"${fontFamily(k)}";src:url("${FONT_ROUTE}/${FONT_FILES[k].file}") format("truetype");font-display:block}`)
    .join("");
}

const attr = (name: string, v: string | number | undefined) => (v === undefined ? "" : ` ${name}="${typeof v === "number" ? n(v) : escapeXml(v)}"`);

export function sceneToSvg(scene: Scene, opts: { label: string }): string {
  const used = new Set<FontKey>();
  const body: string[] = [];
  for (const p of scene.prims) {
    switch (p.t) {
      case "rect":
        body.push(
          `<rect${attr("x", p.x)}${attr("y", p.y)}${attr("width", p.w)}${attr("height", p.h)}${attr("fill", p.fill ?? "none")}${attr("stroke", p.stroke)}${attr("stroke-width", p.stroke ? (p.sw ?? 1) : undefined)}${attr("opacity", p.opacity)}/>`,
        );
        break;
      case "line":
        body.push(`<line${attr("x1", p.x1)}${attr("y1", p.y1)}${attr("x2", p.x2)}${attr("y2", p.y2)}${attr("stroke", p.stroke)}${attr("stroke-width", p.sw)}${attr("opacity", p.opacity)}/>`);
        break;
      case "path":
        body.push(`<path${attr("d", p.d)}${attr("fill", p.fill ?? "none")}${attr("stroke", p.stroke)}${attr("stroke-width", p.stroke ? (p.sw ?? 1) : undefined)}${attr("opacity", p.opacity)}/>`);
        break;
      case "circle":
        body.push(`<circle${attr("cx", p.cx)}${attr("cy", p.cy)}${attr("r", p.r)}${attr("fill", p.fill ?? "none")}${attr("stroke", p.stroke)}${attr("stroke-width", p.stroke ? (p.sw ?? 1) : undefined)}${attr("opacity", p.opacity)}/>`);
        break;
      case "text": {
        if (!p.text) break;
        used.add(p.font);
        const anchor = p.align === "center" ? "middle" : p.align === "right" ? "end" : "start";
        body.push(
          `<text${attr("x", p.x)}${attr("y", p.y)}${attr("font-family", fontFamily(p.font))}${attr("font-size", p.size)}${attr("text-anchor", anchor)}${attr("fill", p.color)}${attr("opacity", p.opacity)}>${escapeXml(p.text)}</text>`,
        );
        break;
      }
      case "image":
        body.push(`<image${attr("x", p.x)}${attr("y", p.y)}${attr("width", p.w)}${attr("height", p.h)} preserveAspectRatio="none" href="${dataUri(p.image)}"/>`);
        break;
      case "qr":
        body.push(`<path${attr("d", qrPath(p.matrix, p.x, p.y, p.size))}${attr("fill", p.color)} shape-rendering="crispEdges"/>`);
        break;
    }
  }
  const style = `<style>${fontFaceCss([...used])}text{font-kerning:none;white-space:pre}</style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}" role="img"${attr("aria-label", opts.label)} style="display:block;width:100%;height:auto">` +
    style +
    `<rect width="${n(scene.width)}" height="${n(scene.height)}" fill="${escapeXml(scene.background)}"/>` +
    body.join("") +
    `</svg>`
  );
}
