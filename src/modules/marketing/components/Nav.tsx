"use client";

import Image from "next/image";
import Link from "next/link";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { demoHref } from "../config";
import css from "../landing.module.css";

/** Cream on the chalkboard; turns to frosted glass with dark text once the page scrolls. */
export function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));
  // A link to a section opens the page already scrolled, with no scroll event to catch.
  useEffect(() => setScrolled(window.scrollY > 12), []);

  const link = cx("rounded-full px-3 py-2 whitespace-nowrap [transition-property:color] duration-150", scrolled ? "text-muted hover:text-ink" : "text-canvas/70 hover:text-canvas");
  const strong = cx("rounded-full px-2 py-2 whitespace-nowrap [transition-property:color] duration-150 sm:px-3", scrolled ? "text-ink hover:text-brand" : "text-canvas hover:text-gold");

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <nav
        aria-label="Main"
        className={`mx-auto flex h-14 max-w-[1360px] items-center justify-between rounded-full pr-2 pl-5 [transition-property:background-color,box-shadow,backdrop-filter] duration-300 ${scrolled ? css.glass : ""}`}
      >
        <Link href="/" aria-label="Zinny home" className="flex shrink-0 items-center rounded-full">
          <Image src={scrolled ? "/brand/zinny-wordmark.png" : "/brand/zinny-wordmark-cream.png"} alt="Zinny" width={407} height={183} priority className="h-7 w-auto" />
        </Link>
        <div className="flex items-center gap-0.5 text-[14px] sm:gap-1">
          {/* To the section, not /marketplace: browsing needs an account, and the section says how to get one. */}
          <a href="#marketplace" className={strong}>
            Marketplace
          </a>
          <a href="#day" className={`${link} hidden md:block`}>
            A day on Zinny
          </a>
          <a href="#everything" className={`${link} hidden lg:block`}>
            Everything it does
          </a>
          <a href="#roles" className={`${link} hidden lg:block`}>
            Every role
          </a>
          {/* The narrowest phones have no room for this one; the page below still has a way to sign in. */}
          <Link href="/login" className={`${strong} hidden min-[360px]:block`}>
            Sign in
          </Link>
          <Link
            href="/signup"
            className={cx(
              "ml-1 rounded-full px-4 py-2 font-medium whitespace-nowrap [transition-property:background-color,transform] duration-150 active:scale-[0.96]",
              scrolled ? "bg-brand text-canvas hover:bg-brand-strong" : "bg-canvas text-brand-deep hover:bg-surface",
            )}
          >
            Sign up
          </Link>
          {/* Phones keep this button in the hero, just below. */}
          <a
            href={demoHref}
            className={cx(
              "ml-1 hidden rounded-full px-4 py-2 font-medium whitespace-nowrap ring-1 [transition-property:background-color,box-shadow] duration-150 sm:block",
              scrolled ? "text-ink ring-line hover:bg-surface hover:ring-faint" : "text-canvas ring-canvas/25 hover:bg-canvas/10",
            )}
          >
            Book a demo
          </a>
        </div>
      </nav>
    </header>
  );
}
