/**
 * Placeholder signatures for demo data: a handwriting-like stroke drawn from the person's
 * name, rasterised with anti-aliasing into a transparent PNG. Generated locally, so the
 * seed needs no network. Real templates use signatures uploaded by staff.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes RGBA pixels (row by row) as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())]);
}

/** A small deterministic random generator, so the same name always gives the same signature. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

type Pt = { x: number; y: number; w: number };

/**
 * Strokes for a signature: one cursive run per word of the name (tall loops for capitals
 * and ascenders, small humps for x-height letters, dips for descenders), slanted, then an
 * underline flourish.
 */
function strokes(name: string, width: number, height: number): Pt[][] {
  const r = rng(name);
  const words = name.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, "")).filter(Boolean).slice(0, 3);
  if (words.length === 0) words.push("Signature");
  // The first word in full, later words shortened, the way people sign.
  const shown = words.map((w, i) => (i === 0 ? w.slice(0, 7) : w.slice(0, i === words.length - 1 ? 5 : 1)));
  const total = shown.reduce((n, w) => n + w.length, 0) + (shown.length - 1) * 0.8;
  const base = height * 0.64;
  const left = width * 0.06;
  const letterW = (width * 0.84) / total;
  const slant = 0.32;
  const out: Pt[][] = [];
  let x = left;
  for (const word of shown) {
    const line: Pt[] = [];
    for (const ch of word) {
      const upper = ch !== ch.toLowerCase();
      const asc = upper || "bdfhklt".includes(ch);
      const desc = "gjpqy".includes(ch);
      const h = (asc ? height * (upper ? 0.5 : 0.42) : desc ? -height * 0.26 : height * 0.17) * (0.85 + r() * 0.3);
      const w = letterW * (0.85 + r() * 0.3);
      const loop = asc || desc ? 0.38 : 0.12;
      for (let i = 0; i <= 28; i++) {
        const t = i / 28;
        const a = t * Math.PI * 2;
        const lift = (h * (1 - Math.cos(a))) / 2;
        line.push({ x: x + w * t - Math.sin(a) * w * loop + lift * slant, y: base - lift, w: 2.2 + 1.6 * Math.sin(t * Math.PI) });
      }
      x += w;
    }
    out.push(line);
    x += letterW * 0.8;
  }
  const flourish: Pt[] = [];
  const fy = base + height * 0.15;
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    flourish.push({ x: left + width * 0.84 * (0.04 + 0.98 * t), y: fy - height * 0.06 * Math.sin(t * Math.PI) + height * 0.025 * t, w: 1.2 + 1.8 * Math.sin(t * Math.PI) });
  }
  out.push(flourish);
  return out;
}

/** A transparent PNG of a placeholder signature in dark blue ink. */
export function signaturePng(name: string, width = 480, height = 150): Buffer {
  const coverage = new Float32Array(width * height);
  for (const line of strokes(name, width, height)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const half = (a.w + b.w) / 4;
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + half + 1));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + half + 1));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
          const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
          const cov = Math.max(0, Math.min(1, half + 0.5 - d));
          const k = y * width + x;
          if (cov > coverage[k]) coverage[k] = cov;
        }
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let k = 0; k < coverage.length; k++) {
    rgba[k * 4] = 0x1c;
    rgba[k * 4 + 1] = 0x2b;
    rgba[k * 4 + 2] = 0x5a;
    rgba[k * 4 + 3] = Math.round(coverage[k] * 235);
  }
  return encodePng(width, height, rgba);
}
