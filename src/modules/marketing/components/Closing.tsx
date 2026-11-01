import Image from "next/image";
import Link from "next/link";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className={`mx-auto max-w-[1400px] overflow-hidden rounded-[36px] px-6 pt-28 pb-10 text-canvas sm:px-10 md:pt-36 lg:px-16 ${css.chalkboard}`}>
        <Reveal className="mx-auto max-w-[1180px]">
          <h2 id="closing-title" className={`${display.className} ${css.headline} text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.98] tracking-[-0.025em]`}>
            Your institute, in order. <em className="text-gold">Its lectures, on the shelf.</em>
          </h2>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
            <a href={demoHref} className="flex flex-col gap-5 rounded-[24px] bg-canvas p-5 text-brand-deep [transition-property:background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface">
              <span className="text-[14px] text-brand-deep/70">A walkthrough on your own courses and batches</span>
              <span className="text-[19px] font-medium">Book a demo</span>
            </a>
            <Link href="/signup" className="flex flex-col gap-5 rounded-[24px] bg-canvas/[0.09] p-5 ring-1 ring-canvas/15 [transition-property:background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-canvas/[0.14]">
              <span className="text-[14px] text-canvas/65">Start learning from institutes on Zinny</span>
              <span className="text-[19px] font-medium">Create a student account</span>
            </Link>
          </div>
          <p className="mt-5 text-[15px] text-canvas/70">
            Already with us?{" "}
            <Link href="/login" className="text-canvas underline underline-offset-4 hover:text-gold">
              Sign in
            </Link>
          </p>
        </Reveal>

        <footer className="mx-auto mt-24 flex max-w-[1180px] flex-col items-center justify-between gap-6 border-t border-canvas/10 pt-8 text-[13px] text-canvas/55 sm:flex-row">
          <Image src="/brand/zinny-wordmark-cream.png" alt="Zinny" width={407} height={183} className="h-6 w-auto opacity-90" />
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <a href="#marketplace" className="hover:text-canvas">Marketplace</a>
            <a href="#day" className="hover:text-canvas">A day on Zinny</a>
            <a href="#everything" className="hover:text-canvas">Everything it does</a>
            <a href="#roles" className="hover:text-canvas">Every role</a>
            <Link href="/verify" className="hover:text-canvas">Verify a certificate</Link>
            <Link href="/login" className="hover:text-canvas">Sign in</Link>
            <Link href="/signup" className="hover:text-canvas">Sign up</Link>
          </nav>
          <p>© 2026 Zinny</p>
        </footer>
      </div>
    </section>
  );
}
