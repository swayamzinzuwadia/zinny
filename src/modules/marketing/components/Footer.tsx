import Image from "next/image";
import Link from "next/link";

/** The public pages' footer, on the deep green. */
export function Footer() {
  return (
    <footer className="flex flex-col items-center justify-between gap-4 bg-brand-deep px-6 py-7 text-[13px] text-canvas/70 sm:flex-row sm:px-10">
      <Image src="/brand/zinny-wordmark-cream.png" alt="Zinny" width={407} height={183} className="h-6 w-auto opacity-90" />
      <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
        <Link href="/marketplace" className="hover:text-canvas">
          Marketplace
        </Link>
        <Link href="/book-a-demo" className="hover:text-canvas">
          Book a demo
        </Link>
        <Link href="/verify" className="hover:text-canvas">
          Verify a certificate
        </Link>
        <Link href="/login" className="hover:text-canvas">
          Sign in
        </Link>
        <Link href="/signup" className="hover:text-canvas">
          Sign up
        </Link>
      </nav>
      <p>© 2026 Zinny</p>
    </footer>
  );
}
