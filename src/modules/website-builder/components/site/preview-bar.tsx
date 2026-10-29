import Link from "next/link";
import type { ReactNode } from "react";
import { container } from "./bits";

/** The gold bar on draft previews: this isn't what visitors see (yet). */
export function PreviewBar({ children, back }: { children: ReactNode; back: { href: string; label: string } }) {
  return (
    <div className="sticky top-[68px] z-30 bg-gold text-brand-deep">
      <div className={`${container} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2.5 text-[14px]`}>
        <span>
          <b className="font-semibold">Draft preview.</b> {children}
        </span>
        <Link href={back.href} className="font-medium underline underline-offset-4">
          {back.label}
        </Link>
      </div>
    </div>
  );
}
