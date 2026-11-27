/**
 * What the sign-up and KYC forms offer and check. Pure, so pages (server) and forms
 * (browser) share it.
 */

/** A self-signed institute's free trial, in days. */
export const TRIAL_DAYS = 3;

export const INSTITUTE_TYPES = [
  { key: "coaching", label: "Coaching institute" },
  { key: "school", label: "School" },
  { key: "college", label: "College" },
  { key: "university", label: "University" },
  { key: "training", label: "Skills or training centre" },
  { key: "other", label: "Other" },
] as const;
export type InstituteType = (typeof INSTITUTE_TYPES)[number]["key"];
export const INSTITUTE_TYPE_LABEL: Record<string, string> = Object.fromEntries(INSTITUTE_TYPES.map((t) => [t.key, t.label]));

export const DOCUMENT_KINDS = [
  { key: "pan", label: "PAN card", required: true, hint: "The institute's PAN card, or the owner's for a sole proprietorship." },
  { key: "gst_certificate", label: "GST certificate", required: false, hint: "If you are registered for GST." },
  { key: "partnership_deed", label: "Partnership deed", required: false, hint: "For a partnership firm or LLP." },
  { key: "moa", label: "Memorandum of association (MOA)", required: false, hint: "For a company, society or trust." },
  { key: "aoa", label: "Articles of association (AOA)", required: false, hint: "For a company." },
  { key: "registration", label: "Licence or registration", required: false, hint: "Shop and establishment licence, trust or society registration, affiliation letter." },
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["key"];
export const DOCUMENT_LABEL: Record<string, string> = Object.fromEntries(DOCUMENT_KINDS.map((d) => [d.key, d.label]));
export const isDocumentKind = (v: string): v is DocumentKind => DOCUMENT_KINDS.some((d) => d.key === v);

/** Uploads: PDF, JPG or PNG, up to 10 MB. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_TYPES: Record<string, { ext: string; label: string }> = {
  "application/pdf": { ext: "pdf", label: "PDF" },
  "image/jpeg": { ext: "jpg", label: "JPG" },
  "image/png": { ext: "png", label: "PNG" },
};
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
/** Files are sent in parts of this size: server actions take 1 MB and Vercel functions about 4.5 MB per request. */
export const PART_BYTES = 3 * 1024 * 1024;

/** The content type a file name and browser type point to, or null when it isn't PDF, JPG or PNG. */
export function documentType(fileName: string, browserType: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const byExt = ext === "pdf" ? "application/pdf" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : null;
  if (browserType && DOCUMENT_TYPES[browserType] && (!byExt || byExt === browserType)) return browserType;
  return byExt;
}

/** What is wrong with a file before it is sent, or null when it can go. */
export function documentProblem(file: { name: string; size: number; type: string }): string | null {
  if (!documentType(file.name, file.type)) return `${file.name} isn't a PDF, JPG or PNG. Save it as one of those and try again.`;
  if (file.size <= 0) return `${file.name} is empty. Pick the file again.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Files can be up to 10 MB; scan it at a lower resolution or compress it.`;
  return null;
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** GST state codes, for the institute's state (the first two digits of a GSTIN). */
export const GST_STATES: { code: string; name: string }[] = [
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" },
  { code: "10", name: "Bihar" },
  { code: "04", name: "Chandigarh" },
  { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "07", name: "Delhi" },
  { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" },
  { code: "06", name: "Haryana" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" },
  { code: "20", name: "Jharkhand" },
  { code: "29", name: "Karnataka" },
  { code: "32", name: "Kerala" },
  { code: "38", name: "Ladakh" },
  { code: "31", name: "Lakshadweep" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" },
  { code: "14", name: "Manipur" },
  { code: "17", name: "Meghalaya" },
  { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" },
  { code: "21", name: "Odisha" },
  { code: "34", name: "Puducherry" },
  { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" },
  { code: "11", name: "Sikkim" },
  { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
  { code: "16", name: "Tripura" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "05", name: "Uttarakhand" },
  { code: "19", name: "West Bengal" },
];
export const STATE_NAME: Record<string, string> = Object.fromEntries(GST_STATES.map((s) => [s.code, s.name]));

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** "Sunrise Academy, Pune" → "sunrise-academy-pune". */
export function slugFrom(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** The version of the KYC notice students agree to. Change it when the notice's words change. */
export const KYC_NOTICE_VERSION = "2026-11-v1";
