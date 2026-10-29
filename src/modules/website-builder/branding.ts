/**
 * The public site's colours. A university's own colour replaces Zinny green as the site's
 * main colour; cream stays the canvas, ink stays the text colour, and gold keeps its one job
 * (marking what is happening now or needs attention). The main colour must be dark enough
 * to read on cream and to carry cream text, so it is checked for contrast (WCAG AA, 4.5:1).
 */

export const CREAM = "#faf6ea";
export const ZINNY_GREEN = "#0b5e4c";
export const MIN_CONTRAST = 4.5;

/** "#ABC", "abc", "#AABBCC" → "#aabbcc"; anything else → null. */
export function normaliseHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(m)) return `#${m.split("").map((c) => c + c).join("")}`;
  if (/^[0-9a-f]{6}$/.test(m)) return `#${m}`;
  return null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix two colours: weight 0 = a, 1 = b. */
export function mix(a: string, b: string, weight: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * weight) as [number, number, number]);
}

/** The same hue, darkened just enough to pass contrast on cream. */
export function darkenToContrast(hex: string): string {
  let c = hex;
  for (let i = 0; i < 40 && contrast(c, CREAM) < MIN_CONTRAST; i++) c = mix(c, "#000000", 0.06);
  return c;
}

export function isReadableBrand(hex: string): boolean {
  return contrast(hex, CREAM) >= MIN_CONTRAST;
}

export type SitePalette = {
  primary: string;
  /** Footer and hero board. */
  deep: string;
  /** Tinted backgrounds. */
  soft: string;
  /** Hairlines tinted with the brand. */
  line: string;
  /** Text on primary and deep. */
  onPrimary: string;
};

/**
 * The palette for a site: the profile's colour if set, else the university's branding colour
 * (darkened if it is too light to read), else Zinny green.
 */
export function sitePalette(profileColor: string | null | undefined, brandingColor: string | null | undefined): SitePalette {
  const chosen = normaliseHex(profileColor) ?? normaliseHex(brandingColor);
  const primary = chosen ? darkenToContrast(chosen) : ZINNY_GREEN;
  return {
    primary,
    deep: mix(primary, "#000000", 0.38),
    soft: mix(primary, CREAM, 0.9),
    line: mix(primary, CREAM, 0.78),
    onPrimary: CREAM,
  };
}

/** CSS custom properties for the site's root element. */
export function paletteStyle(p: SitePalette): Record<string, string> {
  return {
    "--site-primary": p.primary,
    "--site-deep": p.deep,
    "--site-soft": p.soft,
    "--site-line": p.line,
    "--site-on-primary": p.onPrimary,
  };
}
