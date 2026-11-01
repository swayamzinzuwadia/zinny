"use client";

import Image from "next/image";
import Link from "next/link";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { demoHref } from "../config";
import css from "../landing.module.css";

/** Transparent over the hero; turns to frosted glass once the page scrolls. */
export function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <nav
        aria-label="Main"
        className={`mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full pr-2 pl-5 [transition-property:background-color,box-shadow,backdrop-filter] duration-300 ${
          scrolled ? css.glass : ""
        }`}
      >
        <Link href="/" aria-label="Zinny home" className="flex shrink-0 items-center rounded-full">
          <Image src="/brand/zinny-wordmark.png" alt="Zinny" width={407} height={183} priority className="h-7 w-auto" />
        </Link>
        <div className="flex items-center gap-0.5 text-[14px] sm:gap-1">
          {/* To the section, not /marketplace: browsing needs an account, and the section says how to get one. */}
          <a href="#marketplace" className="rounded-full px-2 py-2 whitespace-nowrap text-ink [transition-property:color] duration-150 hover:text-brand sm:px-3">
            Marketplace
          </a>
          <a href="#story" className="hidden rounded-full px-3 py-2 text-muted [transition-property:color] duration-150 hover:text-ink md:block">
            How it works
          </a>
          <a href="#roles" className="hidden rounded-full px-3 py-2 text-muted [transition-property:color] duration-150 hover:text-ink md:block">
            Every role
          </a>
          {/* The narrowest phones have no room for this one; the page below still has a way to sign in. */}
          <Link href="/login" className="hidden rounded-full px-2 py-2 whitespace-nowrap text-ink [transition-property:color] duration-150 hover:text-brand min-[360px]:block sm:px-3">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="ml-1 rounded-full bg-brand px-4 py-2 font-medium whitespace-nowrap text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand-strong active:scale-[0.96]"
          >
            Sign up
          </Link>
          {/* Phones keep this button in the hero, just below. */}
          <a
            href={demoHref}
            className="ml-1 hidden rounded-full px-4 py-2 font-medium text-ink ring-1 ring-line [transition-property:background-color,box-shadow] duration-150 hover:bg-surface hover:ring-faint sm:block"
          >
            Book a demo
          </a>
        </div>
      </nav>
    </header>
  );
}
