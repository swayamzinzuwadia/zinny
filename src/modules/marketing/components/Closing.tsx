import Image from "next/image";
import Link from "next/link";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="mx-auto max-w-[1400px] overflow-hidden rounded-[36px] bg-brand-deep px-6 pt-28 pb-10 text-canvas md:pt-40">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2
            id="closing-title"
            className={`${display.className} text-[clamp(2.75rem,7vw,6rem)] leading-[0.95] tracking-[-0.025em] ${css.balance}`}
          >
            See your institute, <em className="text-gold">in order.</em>
          </h2>
          <p className={`mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-canvas/70 ${css.pretty}`}>
            A walkthrough on your own departments, courses and batches, with the people who will use it.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={demoHref}
              className="inline-flex h-12 items-center rounded-full bg-canvas px-7 text-[15px] font-medium text-brand-deep [transition-property:background-color,transform] duration-150 hover:bg-surface active:scale-[0.96]"
            >
              Book a demo
            </a>
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-full px-6 text-[15px] text-canvas ring-1 ring-canvas/25 [transition-property:background-color,box-shadow] duration-150 hover:bg-canvas/10 hover:ring-canvas/40"
            >
              Sign in to your institute
            </Link>
          </div>
        </Reveal>

        <footer className="mx-auto mt-32 flex max-w-6xl flex-col items-center justify-between gap-6 border-t border-canvas/10 pt-8 text-[13px] text-canvas/55 sm:flex-row">
          <Image src="/brand/zinny-wordmark-cream.png" alt="Zinny" width={407} height={183} className="h-6 w-auto opacity-90" />
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <a href="#story" className="hover:text-canvas">How it works</a>
            <a href="#roles" className="hover:text-canvas">Every role</a>
            <Link href="/verify" className="hover:text-canvas">Verify a certificate</Link>
            <Link href="/login" className="hover:text-canvas">Sign in</Link>
          </nav>
          <p>© 2026 Zinny</p>
        </footer>
      </div>
    </section>
  );
}
