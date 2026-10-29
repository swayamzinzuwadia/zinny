import Link from "next/link";
import { Avatar, cx } from "./ui";

/** The person at the foot of the sidebar: who you are, a few links, and sign out. */
export function SidebarAccount({
  name,
  roles,
  logout,
  children,
}: {
  name: string;
  roles: string;
  logout: () => Promise<void>;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-canvas/10 px-1 pt-4">
      <div className="flex items-center gap-3">
        <Avatar name={name} size={32} />
        <div className="min-w-0 flex-1 leading-snug">
          <div className="truncate text-[13px] font-medium text-canvas">{name}</div>
          <div className="truncate text-[12px] text-canvas/55">{roles}</div>
        </div>
        <form action={logout}>
          <button
            aria-label="Sign out"
            title="Sign out"
            className="grid size-8 place-items-center rounded-lg text-canvas/55 [transition-property:background-color,color] duration-150 hover:bg-canvas/10 hover:text-canvas"
          >
            <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
            </svg>
          </button>
        </form>
      </div>
      {children && <div className="mt-3 flex flex-wrap gap-1">{children}</div>}
    </div>
  );
}

export function SidebarLink({ href, gold, children }: { href: string; gold?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-full px-2.5 py-1 text-[12px] [transition-property:background-color,color] duration-150",
        gold ? "bg-gold/15 text-gold hover:bg-gold/25" : "bg-canvas/[0.06] text-canvas/70 hover:bg-canvas/[0.12] hover:text-canvas",
      )}
    >
      {children}
    </Link>
  );
}
