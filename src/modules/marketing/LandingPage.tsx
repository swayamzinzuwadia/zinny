import type { ReactNode } from "react";
import { display, text } from "./fonts";
import css from "./landing.module.css";
import { Features } from "./components/Features";
import { Film } from "./components/Film";
import { Finale } from "./components/Finale";
import { Hero } from "./components/Hero";
import { India } from "./components/India";
import { Learners } from "./components/Learners";
import { Loop } from "./components/Loop";
import { Nav } from "./components/Nav";

/**
 * The public landing page, shown at "/" to anyone who isn't signed in. It pitches both sides:
 * what Zinny is in the first screen with a way in for each, then how teaching becomes income,
 * the product for institutes, the marketplace for learners (with what is on sale right now),
 * and what it does for Indian institutes. `shelf` is the live listings, drawn by the app page.
 */
export function LandingPage({ shelf, onSale }: { shelf: ReactNode; onSale: number }) {
  return (
    <div className={`min-h-dvh overflow-x-clip text-ink ${text.className} ${display.variable} ${css.canvas}`}>
      <Nav />
      <main>
        <Hero />
        <Film />
        <Loop />
        <Features />
        <Learners shelf={shelf} count={onSale} />
        <India />
        <Finale />
      </main>
    </div>
  );
}
