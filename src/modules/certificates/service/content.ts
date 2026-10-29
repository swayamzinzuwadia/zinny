/**
 * Turns a template (live, or frozen on an issued certificate) plus the person and course
 * into what the renderer draws: loads the logo and signature images and builds the link.
 */
import { storage } from "@/server/core";
import { imageInfo, loadLogo, type CertificateContent, type ImageAsset } from "../render";
import { formatCode } from "../lib";
import type { TemplateSnapshot } from "../schema";

/** What previews show in place of a real student. */
export const SAMPLE = { studentName: "Aarav Sharma", courseTitle: "Data Analytics", code: "000000000000" } as const;

const signatureCache = new Map<string, ImageAsset | null>();

/** Signature images are stored under a new key on every upload, so a key's bytes never change and can be cached. */
export async function signatureImage(key: string | null | undefined): Promise<ImageAsset | null> {
  if (!key) return null;
  if (signatureCache.has(key)) return signatureCache.get(key)!;
  const file = await storage()
    .get(key)
    .catch(() => null);
  const image = file ? imageInfo(file.body) : null;
  if (signatureCache.size > 200) signatureCache.clear();
  signatureCache.set(key, image);
  return image;
}

export type ContentData = {
  universityName: string;
  logoUrl: string | undefined | null;
  studentName: string;
  courseTitle: string;
  completedOn: string;
  validUntil: string | null;
  /** Stored form, "7K3P9QXAM2D4". */
  code: string;
  verifyUrl: string;
};

export async function buildContent(t: TemplateSnapshot, d: ContentData): Promise<CertificateContent> {
  const [logo, ...images] = await Promise.all([loadLogo(d.logoUrl), ...t.signatories.map((s) => signatureImage(s.imageKey))]);
  return {
    design: t.design,
    universityName: d.universityName,
    logo,
    accentColor: t.accentColor,
    heading: t.heading,
    intro: t.intro,
    body: t.body,
    studentName: d.studentName,
    courseTitle: d.courseTitle,
    completedOn: d.completedOn,
    validUntil: d.validUntil,
    code: formatCode(d.code),
    verifyUrl: d.verifyUrl,
    signatories: t.signatories.map((s, i) => ({ name: s.name, title: s.title, image: images[i] ?? null })),
  };
}
