import { Montserrat, Playfair_Display } from "next/font/google";

/** Headlines on the landing page. The app itself stays in Lexend. */
export const display = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

/** Body text and labels on the landing page. */
export const text = Montserrat({
  subsets: ["latin"],
  display: "swap",
});
