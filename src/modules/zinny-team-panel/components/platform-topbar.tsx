"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BackButton, Breadcrumbs, type TrailParent } from "@/components/page-trail";
import { Avatar, cx } from "@/components/ui";
import "./platform-topbar.css";
import { GlobalSearch } from "./global-search";

/**
 * The bar across the top of the Zinny team panel: a way back, where you are, a search across the panel
 * (press / or Ctrl K anywhere) and your account menu.
 */
export function PlatformTopbar({
  parents,
  name,
  email,
  roles,
  canSearch,
  links,
  logout,
}: {
  parents: TrailParent[];
  name: string;
  email: string;
  roles: string;
  /** Whether this person may open the institutes list (adds the "Search institutes" row). */
  canSearch: boolean;
  /** Pages for the account menu, already limited to what this person may open. */
  links: { label: string; href: string }[];
  logout: () => Promise<void>;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-5 lg:px-10">
        <BackButton base="/platform" rootLabel="Zinny team" parents={parents} />
        <div className="min-w-0 flex-1">
          <Breadcrumbs base="/platform" rootLabel="Zinny team" parents={parents} labels={{ "/signups": "Sign-ups", "/institutes/new": "New institute" }} />
        </div>
        <GlobalSearch canSearchInstitutes={canSearch} />
        <AccountMenu name={name} email={email} roles={roles} links={links} logout={logout} />
      </div>
    </header>
  );
}

function AccountMenu({ name, email, roles, links, logout }: { name: string; email: string; roles: string; links: { label: string; href: string }[]; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex items-center gap-2.5 rounded-full border bg-surface py-1 pr-3 pl-1 [transition-property:border-color,box-shadow] duration-150 hover:border-faint",
          open ? "border-brand ring-4 ring-gold-soft" : "border-line",
        )}
      >
        <Avatar name={name} size={30} />
        <span className="hidden min-w-0 text-left leading-tight lg:block">
          <span className="block max-w-[150px] truncate text-[13px] font-medium text-ink">{name}</span>
          <span className="block max-w-[150px] truncate text-[12px] text-muted">{roles}</span>
        </span>
        <svg aria-hidden viewBox="0 0 16 16" className={cx("size-3.5 text-faint [transition-property:transform] duration-200", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="sr-only">Account menu for {name}</span>
      </button>
      {/* The menu grows from the avatar button and folds back into it. */}
      <div className="ptb-menu absolute top-[calc(100%+8px)] right-0 z-40 w-[260px] origin-top-right" data-open={open} inert={!open}>
        <div role="menu" aria-label="Account" className="overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.2)]">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={name} size={36} />
            <div className="min-w-0 leading-snug">
              <div className="truncate text-[14px] font-medium">{name}</div>
              <div className="truncate text-[12.5px] text-muted">{email}</div>
              <div className="truncate text-[12.5px] text-muted">{roles}</div>
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          {links.map((l) => (
            <Link key={l.href} role="menuitem" href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-[14px] text-ink hover:bg-canvas">
              {l.label}
            </Link>
          ))}
          <form action={logout}>
            <button role="menuitem" className="block w-full rounded-xl px-3 py-2 text-left text-[14px] text-ink hover:bg-canvas">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
