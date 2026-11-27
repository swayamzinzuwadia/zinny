import { Playfair_Display } from "next/font/google";

/** Playfair Display (variable) for h1 and h2 on the public onboarding pages, as on the landing page. */
export const display = Playfair_Display({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-playfair",
});
