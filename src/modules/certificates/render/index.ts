/**
 * Certificate rendering: one layout per design (designs.ts), drawn as a PDF for the
 * stored certificate or as SVG for previews. Server only.
 */
import QRCode from "qrcode";
import { buildScene } from "./designs";
import { measurer } from "./fonts";
import { sceneToPdf } from "./pdf";
import type { CertificateContent, QrMatrix } from "./scene";
import { sceneToSvg } from "./svg";

export { DESIGNS, type DesignKey } from "./designs";
export type { CertificateContent, ImageAsset } from "./scene";
export { accentFrom } from "./scene";
export { imageInfo, loadLogo } from "./images";

export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  return { size, dark: (r, c) => data[r * size + c] === 1 };
}

async function scene(c: CertificateContent) {
  return buildScene(c, { measure: await measurer(), qr: qrMatrix(c.verifyUrl) });
}

export async function renderCertificatePdf(c: CertificateContent, opts: { createdAt?: Date } = {}): Promise<Uint8Array> {
  return sceneToPdf(await scene(c), {
    title: `${c.heading}: ${c.studentName}, ${c.courseTitle}`,
    author: c.universityName,
    subject: `Certificate ${c.code} for ${c.courseTitle}`,
    keywords: ["certificate", c.code, c.courseTitle],
    createdAt: opts.createdAt,
  });
}

export async function renderCertificateSvg(c: CertificateContent): Promise<string> {
  return sceneToSvg(await scene(c), { label: `${c.heading} for ${c.studentName}, ${c.courseTitle}` });
}
