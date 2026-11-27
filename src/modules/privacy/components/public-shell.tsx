import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";

/** Playfair Display (variable) for h1 and h2 on the public privacy pages, as on the landing page. */
const display = Playfair_Display({ subsets: ["latin"], weight: "variable", display: "swap", variable: "--font-playfair" });

/** The frame of the public privacy pages: the logo, a way home, and the page. */
export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`display-headings flex min-h-dvh flex-col bg-canvas text-ink ${display.variable}`}>
      <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 pt-5 sm:px-8 sm:pt-7">
        <Link href="/" aria-label="Zinny home" className="inline-flex rounded-lg">
          <Logo height={30} />
        </Link>
        <nav className="flex items-center gap-4 text-[14px]">
          <Link href="/privacy" className="text-muted hover:text-ink">
            Privacy notice
          </Link>
          <Link href="/privacy/my" className="font-medium text-brand hover:underline">
            Your privacy
          </Link>
        </nav>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pt-8 pb-28 sm:px-8 sm:pt-12 ${wide ? "max-w-[1100px]" : "max-w-[760px]"}`}>{children}</main>
    </div>
  );
}
