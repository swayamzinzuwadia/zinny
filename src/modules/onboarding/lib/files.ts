/** Checks on uploaded documents that need the bytes (server only). */

/** The real type of a file from its first bytes, or null when it isn't a PDF, JPG or PNG. */
export function sniffType(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** A file name safe to show and to offer as a download name: no folders, no control characters, at most 120 characters. */
export function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "document";
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot) : "";
  return clean.slice(0, 120 - ext.length) + ext;
}
