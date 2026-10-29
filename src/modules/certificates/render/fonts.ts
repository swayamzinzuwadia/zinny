/**
 * The fonts certificates use, read from npm packages (OFL-licensed Google Fonts as TTF):
 * Lexend (the Zinny typeface) and Libre Baskerville (for the classic and minimal designs).
 *
 * The same files are embedded in the PDF and served to the browser for the SVG preview
 * (`/verify/fonts/<file>`), and text is measured with the same metrics in both, so the
 * preview lines up with the PDF.
 *
 * Paths are written out literally from `process.cwd()` so Next's output file tracing can
 * see them and ship them with the server bundle.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";

export const FONT_FILES = {
  sansLight: { file: "lexend-300.ttf", path: () => join(process.cwd(), "node_modules", "@expo-google-fonts", "lexend", "300Light", "Lexend_300Light.ttf") },
  sans: { file: "lexend-400.ttf", path: () => join(process.cwd(), "node_modules", "@expo-google-fonts", "lexend", "400Regular", "Lexend_400Regular.ttf") },
  sansBold: { file: "lexend-600.ttf", path: () => join(process.cwd(), "node_modules", "@expo-google-fonts", "lexend", "600SemiBold", "Lexend_600SemiBold.ttf") },
  serif: {
    file: "baskerville-400.ttf",
    path: () => join(process.cwd(), "node_modules", "@expo-google-fonts", "libre-baskerville", "400Regular", "LibreBaskerville_400Regular.ttf"),
  },
  serifItalic: {
    file: "baskerville-400-italic.ttf",
    path: () => join(process.cwd(), "node_modules", "@expo-google-fonts", "libre-baskerville", "400Regular_Italic", "LibreBaskerville_400Regular_Italic.ttf"),
  },
  serifBold: {
    file: "baskerville-700.ttf",
    path: () => join(process.cwd(), "node_modules", "@expo-google-fonts", "libre-baskerville", "700Bold", "LibreBaskerville_700Bold.ttf"),
  },
} as const;

export type FontKey = keyof typeof FONT_FILES;
export const FONT_KEYS = Object.keys(FONT_FILES) as FontKey[];

/** The CSS family name each font gets in the SVG preview (one family per file, so no weight synthesis). */
export const fontFamily = (key: FontKey) => `ZinnyCert-${key}`;

const bytesCache = new Map<FontKey, Promise<Buffer>>();

export function fontBytes(key: FontKey): Promise<Buffer> {
  let p = bytesCache.get(key);
  if (!p) {
    p = readFile(FONT_FILES[key].path());
    p.catch(() => bytesCache.delete(key));
    bytesCache.set(key, p);
  }
  return p;
}

/** The font for a public file name ("lexend-400.ttf"), or null. */
export function fontByFile(file: string): FontKey | null {
  return FONT_KEYS.find((k) => FONT_FILES[k].file === file) ?? null;
}

type FkFont = { unitsPerEm: number; layout(text: string): { glyphs: { advanceWidth: number }[] }; hasGlyphForCodePoint(cp: number): boolean };
const fkCache = new Map<FontKey, Promise<FkFont>>();

async function fkFont(key: FontKey): Promise<FkFont> {
  let p = fkCache.get(key);
  if (!p) {
    p = fontBytes(key).then((b) => fontkit.create(b) as unknown as FkFont);
    p.catch(() => fkCache.delete(key));
    fkCache.set(key, p);
  }
  return p;
}

/** Width of `text` at `size` points, the way pdf-lib lays it out (glyph advances, no kerning). */
export type Measure = (font: FontKey, text: string, size: number) => number;

/** Loads every font once and returns a synchronous measure function. */
export async function measurer(): Promise<Measure> {
  const fonts = new Map<FontKey, FkFont>(await Promise.all(FONT_KEYS.map(async (k) => [k, await fkFont(k)] as const)));
  const cache = new Map<string, number>();
  return (font, text, size) => {
    const k = `${font}\u0000${text}`;
    let units = cache.get(k);
    if (units === undefined) {
      const f = fonts.get(font)!;
      units = f.layout(text).glyphs.reduce((n, g) => n + g.advanceWidth, 0) / f.unitsPerEm;
      if (cache.size > 5000) cache.clear();
      cache.set(k, units);
    }
    return units * size;
  };
}

/** Characters in `text` that `font` can't draw (for example Devanagari in Lexend). */
export async function missingGlyphs(font: FontKey, text: string): Promise<string[]> {
  const f = await fkFont(font);
  return [...new Set([...text].filter((ch) => !/\s/.test(ch) && !f.hasGlyphForCodePoint(ch.codePointAt(0)!)))];
}
