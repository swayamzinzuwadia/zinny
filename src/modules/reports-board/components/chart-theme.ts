/**
 * The brand tokens from src/app/globals.css, as values Recharts can put straight into SVG
 * attributes. Keep in step with the @theme block there.
 *   green  = the main series
 *   gold   = only the highlight: the current week or month
 *   cream  = the chart background
 */
export const CHART = {
  brand: "#0b5e4c",
  brandSoft: "#e3eee8",
  gold: "#d4a72a",
  canvas: "#faf6ea",
  surface: "#fffdf7",
  line: "#e8e0cc",
  muted: "#5d6b64",
  ink: "#14261f",
} as const;
