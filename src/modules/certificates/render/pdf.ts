/** Draws a scene into a one-page PDF with pdf-lib, embedding (subsets of) the fonts it uses. */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { fontBytes, type FontKey } from "./fonts";
import { hexToRgb, qrPath, type ImageAsset, type Scene } from "./scene";

const color = (hex: string) => rgb(...hexToRgb(hex));

export type PdfMeta = { title: string; author: string; subject: string; keywords: string[]; createdAt?: Date };

export async function sceneToPdf(scene: Scene, meta: PdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const created = meta.createdAt ?? new Date();
  doc.setTitle(meta.title, { showInWindowTitleBar: true });
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setKeywords(meta.keywords);
  doc.setCreator("Zinny");
  doc.setProducer("Zinny");
  doc.setCreationDate(created);
  doc.setModificationDate(created);
  doc.setLanguage("en-IN");

  const H = scene.height;
  const page: PDFPage = doc.addPage([scene.width, scene.height]);
  page.drawRectangle({ x: 0, y: 0, width: scene.width, height: scene.height, color: color(scene.background) });

  const fonts = new Map<FontKey, PDFFont>();
  const font = async (k: FontKey) => {
    let f = fonts.get(k);
    if (!f) {
      f = await doc.embedFont(await fontBytes(k), { subset: true });
      fonts.set(k, f);
    }
    return f;
  };
  const images = new Map<ImageAsset, PDFImage>();
  const image = async (a: ImageAsset) => {
    let i = images.get(a);
    if (!i) {
      i = a.mime === "image/png" ? await doc.embedPng(a.bytes) : await doc.embedJpg(a.bytes);
      images.set(a, i);
    }
    return i;
  };

  for (const p of scene.prims) {
    switch (p.t) {
      case "rect":
        page.drawRectangle({
          x: p.x,
          y: H - p.y - p.h,
          width: p.w,
          height: p.h,
          ...(p.fill ? { color: color(p.fill) } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: p.sw ?? 1 } : {}),
          ...(p.opacity !== undefined && { opacity: p.opacity, borderOpacity: p.opacity }),
        });
        break;
      case "line":
        page.drawLine({ start: { x: p.x1, y: H - p.y1 }, end: { x: p.x2, y: H - p.y2 }, thickness: p.sw, color: color(p.stroke), ...(p.opacity !== undefined && { opacity: p.opacity }) });
        break;
      case "path":
        page.drawSvgPath(p.d, {
          x: 0,
          y: H,
          ...(p.fill ? { color: color(p.fill) } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: p.sw ?? 1 } : {}),
          ...(p.opacity !== undefined && { opacity: p.opacity, borderOpacity: p.opacity }),
        });
        break;
      case "circle":
        page.drawCircle({
          x: p.cx,
          y: H - p.cy,
          size: p.r,
          ...(p.fill ? { color: color(p.fill) } : {}),
          ...(p.stroke ? { borderColor: color(p.stroke), borderWidth: p.sw ?? 1 } : {}),
          ...(p.opacity !== undefined && { opacity: p.opacity, borderOpacity: p.opacity }),
        });
        break;
      case "text": {
        if (!p.text) break;
        const f = await font(p.font);
        const w = f.widthOfTextAtSize(p.text, p.size);
        const x = p.align === "center" ? p.x - w / 2 : p.align === "right" ? p.x - w : p.x;
        page.drawText(p.text, { x, y: H - p.y, size: p.size, font: f, color: color(p.color), ...(p.opacity !== undefined && { opacity: p.opacity }) });
        break;
      }
      case "image":
        page.drawImage(await image(p.image), { x: p.x, y: H - p.y - p.h, width: p.w, height: p.h });
        break;
      case "qr":
        page.drawSvgPath(qrPath(p.matrix, p.x, p.y, p.size), { x: 0, y: H, color: color(p.color) });
        break;
    }
  }
  return doc.save({ useObjectStreams: true });
}
