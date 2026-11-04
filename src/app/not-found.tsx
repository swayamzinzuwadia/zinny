import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";
import { display } from "@/modules/marketing/fonts";

/** Any address that isn't a page: on brand, with a way back. */
export default function NotFound() {
  return (
    <main className={`display-headings flex min-h-dvh flex-col bg-canvas px-5 py-8 text-ink sm:px-10 ${display.variable}`}>
      <Link href="/" aria-label="Zinny home" className="inline-flex w-fit rounded-lg">
        <Logo height={30} />
      </Link>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-16">
        <p className="text-[14px] font-medium text-muted">Page not found</p>
        <h1 className="mt-2 text-[clamp(2.2rem,5vw,3.4rem)] leading-[1.05] tracking-[-0.02em]">This page isn&apos;t here</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink/75">
          The link may be old, or the page may have moved. Check the address, or start again from the home page.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className={buttonClass("primary")}>
            Go to the home page
          </Link>
          <Link href="/marketplace" className={buttonClass("secondary")}>
            Browse the marketplace
          </Link>
        </div>
      </div>
    </main>
  );
}
