/**
 * Upload rules for lesson files: size limits, part size, file names safe for storage keys,
 * and the real file type read from the first bytes (the browser's claim is never trusted).
 */

export const MB = 1024 * 1024;
/** Each upload request carries one part, so requests stay under serverless body limits (4.5 MB on Vercel). */
export const PART_SIZE = 4 * MB;
export const MAX_BYTES = { video: 250 * MB, pdf: 50 * MB } as const;
export type UploadKind = keyof typeof MAX_BYTES;

export const ACCEPT: Record<UploadKind, string> = {
  video: "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov",
  pdf: "application/pdf,.pdf",
};

export function partCount(size: number, partSize = PART_SIZE) {
  return Math.max(1, Math.ceil(size / partSize));
}

/** Expected byte length of part `n` (0-based). */
export function partLength(size: number, n: number, partSize = PART_SIZE) {
  const count = partCount(size, partSize);
  if (n < 0 || n >= count) return 0;
  return n === count - 1 ? size - partSize * (count - 1) : partSize;
}

/** "Week 1 notes (final).pdf" stays; anything outside the storage key alphabet becomes "-". */
export function safeFileName(name: string, fallback: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ ()+,=@-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(-90);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

/** Reads the type from the file's first bytes. null when it isn't an accepted type. */
export function sniffType(kind: UploadKind, head: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (kind === "pdf") return ascii(0, 5) === "%PDF-" ? "application/pdf" : null;
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  if (head.length >= 12 && ascii(4, 8) === "ftyp") return ascii(8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  return null;
}

export function formatBytes(n: number) {
  if (n >= MB) return `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}
