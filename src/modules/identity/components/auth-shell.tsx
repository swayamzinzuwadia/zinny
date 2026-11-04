import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { display } from "@/modules/marketing/fonts";

/**
 * The layout of every sign-in screen: the green brand panel on large screens, the form on
 * the cream canvas. On phones only the form shows, with the logo above it.
 */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={`display-headings grid min-h-dvh lg:grid-cols-[1fr_1.05fr] ${display.variable}`}>
      <section className="relative hidden overflow-hidden bg-brand-deep p-12 text-canvas lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
        />
        <div className="relative">
          <Link href="/" aria-label="Zinny home" className="inline-flex rounded-lg">
            <Logo height={40} tone="cream" />
          </Link>
        </div>
        <div className="relative max-w-md">
          <p className="font-display text-[44px] leading-[1.08] font-medium">Run your institute. Sell what it teaches.</p>
          <ul className="mt-8 space-y-3 text-[15px] text-canvas/80">
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-canvas/50" />
              Courses, live classes, tests, fees and certificates in one place for each institute.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-canvas/50" />
              A marketplace where anyone can buy the courses an institute has recorded.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-canvas/50" />
              Built for Indian institutes, with UPI payments and GST invoices.
            </li>
          </ul>
        </div>
        <p className="relative text-[13px] text-canvas/70">
          Run an institute?{" "}
          <Link href="/book-a-demo" className="font-medium text-canvas underline-offset-4 hover:underline">
            Book a demo
          </Link>
        </p>
      </section>

      <section className="flex flex-col justify-center px-4 py-10 sm:px-12 sm:py-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Link href="/" aria-label="Zinny home" className="inline-flex rounded-lg">
              <Logo height={34} />
            </Link>
          </div>
          <h1 className="text-[32px] leading-tight font-medium sm:text-[36px]">{title}</h1>
          {subtitle && <div className="mt-2 text-[15px] text-muted">{subtitle}</div>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-10">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

/** A two-option switch (Email / Mobile number) made of links, so it works without JavaScript. */
export function AuthTabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav aria-label="How to sign in" className="mb-6 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1">
      {tabs.map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={
            t.key === active
              ? "rounded-full bg-brand px-4 py-2 text-center text-[14px] font-medium text-canvas"
              : "rounded-full px-4 py-2 text-center text-[14px] text-muted hover:text-ink"
          }
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}
