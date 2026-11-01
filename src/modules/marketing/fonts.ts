import { Montserrat, Playfair_Display } from "next/font/google";

/**
 * Headlines on every public page; the app itself stays in Lexend. This is the variable font,
 * every weight from 400 to 900 in one file, so headlines can pick a weight to suit their size.
 * `variable` is for places that style many headings at once (.display-headings in globals.css).
 */
export const display = Playfair_Display({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-playfair",
});

/** Body text and labels on the landing page. */
export const text = Montserrat({
  subsets: ["latin"],
  display: "swap",
});
