import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, Badge, Empty, PageHeader, cx } from "@/components/ui";
import { ForbiddenError } from "@/server/errors";
import type { RankRow } from "./board";

/** Resolves to null instead of throwing when the viewer has no access, so pages can say so. */
export async function unlessForbidden<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ForbiddenError) return null;
    throw e;
  }
}

export function NoAccess({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Empty title="You don't have access to leaderboards">Ask your institute admin if you need it.</Empty>
    </>
  );
}

const SECTIONS = [
  { href: "", label: "Leaderboard" },
  { href: "/xp-rules", label: "XP rules" },
  { href: "/badges", label: "Badges" },
  { href: "/challenges", label: "Challenges" },
];

/** The four pages of User Leaderboards, so staff can move between them on a tablet too. */
export function SectionNav({ uni, active }: { uni: string; active: string }) {
  return (
    <nav aria-label="User Leaderboards" className="mb-6 flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 md:hidden">
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={`/${uni}/admin/leaderboards${s.href}`}
          aria-current={s.href === active ? "page" : undefined}
          className={cx("whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px]", s.href === active ? "bg-brand font-medium text-canvas" : "text-muted")}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** The top three, with first place on the chalkboard. Ties share a place. */
export function Podium({ rows }: { rows: RankRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((r) => {
        const first = r.rank === 1;
        return (
          <div
            key={r.userId}
            className={cx("flex items-center gap-3 rounded-[22px] border p-4", first ? "border-brand-deep bg-brand-deep text-canvas" : "border-line bg-surface")}
          >
            <span
              className={cx(
                "tabular inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold",
                first ? "bg-canvas text-brand-deep" : "bg-brand-soft text-brand-strong",
              )}
            >
              {r.rank}
            </span>
            <Avatar name={r.name} size={36} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{r.name}</div>
              <div className={cx("tabular text-[13px]", first ? "text-canvas/75" : "text-muted")}>{r.points.toLocaleString("en-IN")} XP</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScopeChip({ children, department }: { children: ReactNode; department: boolean }) {
  return <Badge tone={department ? "neutral" : "brand"}>{children}</Badge>;
}
