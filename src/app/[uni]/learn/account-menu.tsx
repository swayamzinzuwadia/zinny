"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar, cx } from "@/components/ui";

export type AccountLink = { href: string; label: string; phoneOnly?: boolean };

/** The avatar menu in the learner app. Closes on a click outside, on Escape, and on navigation. */
export function AccountMenu({
  name,
  email,
  links,
  logout,
}: {
  name: string;
  email: string;
  links: AccountLink[];
  logout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => setOpen((o) => !o)}
        className="block rounded-full outline-offset-2 [transition-property:box-shadow] duration-150 hover:ring-2 hover:ring-line"
      >
        <Avatar name={name} size={34} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-60 rounded-2xl border border-line bg-surface p-2 text-[14px] shadow-[0_16px_40px_-12px_rgb(20_38_31/0.25)]">
          <div className="px-3 pt-2 pb-3">
            <div className="truncate font-medium">{name}</div>
            <div className="truncate text-[12.5px] text-muted">{email}</div>
          </div>
          <ul className="border-t border-line pt-1.5">
            {links.map((l) => (
              <li key={l.href} className={cx(l.phoneOnly && "sm:hidden")}>
                <Link role="menuitem" href={l.href} className="block rounded-xl px-3 py-2 text-ink hover:bg-canvas">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <form action={logout} className="mt-1.5 border-t border-line pt-1.5">
            <button role="menuitem" className="w-full rounded-xl px-3 py-2 text-left text-brand hover:bg-canvas">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
