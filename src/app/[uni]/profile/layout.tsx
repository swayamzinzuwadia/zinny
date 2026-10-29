import Link from "next/link";
import { Logo } from "@/components/ui";
import { spaceContext } from "@/server/context";

/**
 * The profile page is shared by the admin panel and the learner app, so it has its own
 * simple frame with a way back to whichever app the person uses (both, for some).
 */
export default async function ProfileLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { university, isAdminUser, isLearner } = await spaceContext(uni);
  return (
    <div className="mx-auto min-h-dvh max-w-4xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <Link href={isAdminUser ? `/${uni}/admin` : isLearner ? `/${uni}/learn` : "/"} className="flex min-w-0 items-center gap-3">
          <Logo height={28} />
          <span className="hidden truncate border-l border-line pl-3 text-[13px] text-muted sm:inline">{university.name}</span>
        </Link>
        <nav className="flex items-center gap-4 text-[14px]">
          {isAdminUser && (
            <Link href={`/${uni}/admin`} className="text-brand hover:underline">
              Admin panel
            </Link>
          )}
          {isLearner && (
            <Link href={`/${uni}/learn`} className="text-brand hover:underline">
              Learner app
            </Link>
          )}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
