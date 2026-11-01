import { text } from "./fonts";
import css from "./landing.module.css";
import { Cursor } from "./components/Cursor";
import { Film } from "./components/Film";
import { Finale } from "./components/Finale";
import { Nav } from "./components/Nav";
import { SmoothScroll } from "./components/SmoothScroll";

/** The public landing page, shown at "/" to anyone who isn't signed in. */
export function LandingPage() {
  return (
    <div className={`min-h-dvh overflow-x-clip text-ink ${text.className} ${css.canvas}`}>
      <SmoothScroll />
      <Cursor />
      <Nav />
      <main>
        <Film />
        <Finale />
      </main>
    </div>
  );
}
