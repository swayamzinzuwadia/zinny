/**
 * The institute profile (Website › Manage profile): about, address, contact details,
 * social links, logo, cover image and the site's colour. Live on the public site as soon
 * as it is saved.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, universityLite, withTenant, type Actor } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { assertManage } from "./access";
import { darkenToContrast, isReadableBrand, normaliseHex } from "./branding";
import { assertMediaOf } from "./media";
import { siteProfiles, type SocialLinks } from "./schema";
import { cleanEmail, cleanPhone, cleanUrl, optionalText } from "./validate";

export type SiteProfile = typeof siteProfiles.$inferSelect;

export const SOCIAL_NETWORKS: { key: keyof SocialLinks; label: string; placeholder: string }[] = [
  { key: "website", label: "Main website", placeholder: "https://www.demo.edu" },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/demouniversity" },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/school/demo-university" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@demouniversity" },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/demouniversity" },
  { key: "x", label: "X (Twitter)", placeholder: "https://x.com/demouni" },
];

export type ProfileInput = {
  tagline?: string;
  about?: string;
  foundedYear?: string | number | null;
  address?: string;
  city?: string;
  mapUrl?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  social?: Partial<Record<keyof SocialLinks, string>>;
  primaryColor?: string | null;
  /** "" or null removes the image; undefined keeps it. */
  logoMediaId?: string | null;
  coverMediaId?: string | null;
};

/** The profile row, created empty the first time anyone asks for it. */
export async function ensureProfile(tx: Tx, universityId: string): Promise<SiteProfile> {
  const [existing] = await tx.select().from(siteProfiles).where(eq(siteProfiles.universityId, universityId));
  if (existing) return existing;
  const [created] = await tx.insert(siteProfiles).values({ universityId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await tx.select().from(siteProfiles).where(eq(siteProfiles.universityId, universityId));
  return again;
}

export async function getProfile(actor: Actor) {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => ({ profile: await ensureProfile(tx, universityId), university: await universityLite(tx) }));
}

function cleanYear(v: ProfileInput["foundedYear"]): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  const max = new Date().getUTCFullYear();
  if (!Number.isInteger(n) || n < 1800 || n > max) throw new ValidationError(`Enter the year you were founded as four digits, between 1800 and ${max}.`);
  return n;
}

export function cleanColor(v: ProfileInput["primaryColor"]): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const hex = normaliseHex(String(v));
  if (!hex) throw new ValidationError("Enter the colour as a hex code, like #17365d.");
  if (!isReadableBrand(hex)) {
    throw new ValidationError(`${hex} is too light to read on the cream background. Pick a darker shade, like ${darkenToContrast(hex)}.`);
  }
  return hex;
}

export async function saveProfile(actor: Actor, input: ProfileInput): Promise<SiteProfile> {
  const universityId = assertManage(actor);
  const social: SocialLinks = {};
  for (const n of SOCIAL_NETWORKS) {
    const url = cleanUrl(input.social?.[n.key], n.label);
    if (url) social[n.key] = url;
  }
  const values = {
    tagline: optionalText(input.tagline, "The tagline", 160),
    about: optionalText(input.about, "About", 6000),
    foundedYear: cleanYear(input.foundedYear),
    address: optionalText(input.address, "The address", 400),
    city: optionalText(input.city, "The city", 80),
    mapUrl: cleanUrl(input.mapUrl, "The map link"),
    phone: cleanPhone(input.phone, { required: false }),
    email: cleanEmail(input.email, { required: false }),
    whatsapp: cleanPhone(input.whatsapp, { required: false }),
    social,
    primaryColor: cleanColor(input.primaryColor),
  };
  return withTenant(actor, async (tx) => {
    const current = await ensureProfile(tx, universityId);
    const logoMediaId = input.logoMediaId === undefined ? current.logoMediaId : input.logoMediaId || null;
    const coverMediaId = input.coverMediaId === undefined ? current.coverMediaId : input.coverMediaId || null;
    await assertMediaOf(tx, logoMediaId);
    await assertMediaOf(tx, coverMediaId);
    const [saved] = await tx
      .update(siteProfiles)
      .set({ ...values, logoMediaId, coverMediaId, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(siteProfiles.id, current.id))
      .returning();
    await audit(tx, actor, "site.update_profile", "site_profile", saved.id, {
      fields: Object.keys(values).filter((k) => JSON.stringify(values[k as keyof typeof values]) !== JSON.stringify(current[k as keyof SiteProfile])),
      logoChanged: logoMediaId !== current.logoMediaId,
      coverChanged: coverMediaId !== current.coverMediaId,
    });
    return saved;
  });
}
