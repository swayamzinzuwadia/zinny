/**
 * Images on certificates: the university's logo and signatory signatures.
 * Only PNG and JPEG, which both the PDF and every browser can draw. The type is decided
 * by the file's own bytes, never by its name or a header.
 */
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { ImageAsset } from "./scene";

const MAX_DIMENSION = 6000;

/** Reads PNG or JPEG dimensions from the bytes. Null for anything else or a damaged file. */
export function imageInfo(bytes: Uint8Array): ImageAsset | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // IHDR is always the first chunk: width and height are big-endian at 16 and 20.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
    return { bytes, mime: "image/png", width, height };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      // Start-of-frame markers carry the size (not DHT c4, JPG c8 or DAC cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
        return { bytes, mime: "image/jpeg", width, height };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function dataUri(image: ImageAsset): string {
  return `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const logoCache = new Map<string, { at: number; image: ImageAsset | null }>();
const LOGO_TTL_MS = 10 * 60 * 1000;

/**
 * The university's logo from `branding.logoUrl`: a data: URL, an https/http URL, or a path
 * under `public/` ("/brand/logo.png"). Returns null (the designs then draw a monogram)
 * when it is missing, too large, slow, or not a PNG or JPEG. Never throws.
 */
export async function loadLogo(url: string | undefined | null): Promise<ImageAsset | null> {
  const u = (url ?? "").trim();
  if (!u) return null;
  const hit = logoCache.get(u);
  if (hit && Date.now() - hit.at < LOGO_TTL_MS) return hit.image;
  const image = await fetchLogo(u).catch(() => null);
  if (logoCache.size > 200) logoCache.clear();
  logoCache.set(u, { at: Date.now(), image });
  return image;
}

async function fetchLogo(u: string): Promise<ImageAsset | null> {
  if (u.startsWith("data:")) {
    const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(u);
    if (!m) return null;
    const bytes = Buffer.from(m[2], "base64");
    return bytes.length <= MAX_LOGO_BYTES ? imageInfo(bytes) : null;
  }
  if (u.startsWith("/") && !u.startsWith("//")) {
    const root = join(process.cwd(), "public");
    const p = normalize(join(root, decodeURIComponent(u.split("?")[0])));
    if (!p.startsWith(root + sep)) return null;
    const bytes = await readFile(p);
    return bytes.length <= MAX_LOGO_BYTES ? imageInfo(bytes) : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const res = await fetch(parsed, { signal: AbortSignal.timeout(4000), redirect: "follow" });
  if (!res.ok || !res.body) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_LOGO_BYTES) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_LOGO_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return imageInfo(Buffer.concat(chunks));
}
