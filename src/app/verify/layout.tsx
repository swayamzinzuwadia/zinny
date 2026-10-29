import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  title: "Check a certificate",
  // Pages show a student's name: keep them out of search engines and link previews' referrers.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** The public certificate check. No sign-in. */
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6 sm:py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/verify" aria-label="Check a certificate">
          <Logo height={28} />
        </Link>
        <span className="text-[13px] text-muted">Certificate check</span>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-10 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
        Institutes on Zinny issue certificates with a code and a QR code. This page checks the code against the institute&apos;s records each time it loads, and shows
        only what is needed to confirm the certificate.
      </footer>
    </div>
  );
}
