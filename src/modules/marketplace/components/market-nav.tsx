"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const SECTIONS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/marketplace/recorded", label: "Recorded" },
  { href: "/marketplace/live", label: "Live" },
  { href: "/marketplace/institutes", label: "Institutes" },
];

/**
 * The marketplace's sections: the two ways to learn, the institutes, and the learner's own
 * library once signed in. One row beside the logo on wide screens, a row of its own on phones.
 */
export function MarketNav({ signedIn, className }: { signedIn: boolean; className?: string }) {
  const path = usePathname();
  const items = signedIn ? [...SECTIONS, { href: "/marketplace/library", label: "My library" }] : SECTIONS;
  return (
    <nav aria-label="Marketplace" className={cx("min-w-0", className)}>
      <ul className="flex gap-0.5 overflow-x-auto text-[14px] [scrollbar-width:none]">
        {items.map((i) => {
          const on = path === i.href || (i.href !== "/marketplace" && path.startsWith(`${i.href}/`));
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "block rounded-full px-3 py-2 whitespace-nowrap [transition-property:color,background-color] duration-150",
                  on ? "bg-canvas/12 font-medium text-canvas" : "text-canvas/75 hover:bg-canvas/10 hover:text-canvas",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
