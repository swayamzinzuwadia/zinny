import { Instrument_Serif } from "next/font/google";

/** Headline face for the landing page only. Lexend stays the face for body text and UI. */
export const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});
