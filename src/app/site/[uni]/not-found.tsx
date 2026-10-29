"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SiteNotFound() {
  const uni = usePathname()?.split("/")[2] ?? "";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:px-8">
      <h1 className="text-[36px] font-semibold tracking-[-0.03em]">This page isn&apos;t here</h1>
      <p className="mt-3 max-w-lg text-[17px] text-muted">It may have moved, or the course or post may no longer be offered. Start again from the home page.</p>
      <Link href={`/site/${uni}`} className="mt-8 inline-flex h-12 items-center rounded-full bg-[var(--site-primary)] px-6 text-[15px] font-medium text-[var(--site-on-primary)]">
        Go to the home page
      </Link>
    </div>
  );
}
