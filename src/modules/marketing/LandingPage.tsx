import css from "./landing.module.css";
import { Campus } from "./components/Campus";
import { Closing } from "./components/Closing";
import { Facts } from "./components/Facts";
import { Hero } from "./components/Hero";
import { India } from "./components/India";
import { MotionRoot } from "./components/MotionRoot";
import { Nav } from "./components/Nav";
import { Roles } from "./components/Roles";
import { Story } from "./components/Story";

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
          <Story />
          <Roles />
          <India />
          <Closing />
        </main>
      </div>
    </MotionRoot>
  );
}
