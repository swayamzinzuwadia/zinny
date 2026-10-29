import css from "./landing.module.css";
import { Campus } from "./components/Campus";
import { Facts } from "./components/Facts";
import { Hero } from "./components/Hero";
import { MotionRoot } from "./components/MotionRoot";
import { Nav } from "./components/Nav";

/** The public landing page, shown at "/" to anyone who isn't signed in. */
export function LandingPage() {
  return (
    <MotionRoot>
      <div className={`min-h-dvh overflow-x-clip text-ink ${css.canvas}`}>
        <Nav />
        <main>
          <Hero />
          <Facts />
          <Campus />
        </main>
      </div>
    </MotionRoot>
  );
}
