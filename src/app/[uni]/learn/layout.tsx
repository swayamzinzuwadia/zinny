import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Logo } from "@/components/ui";
import { signOut } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { LearnNav } from "./nav";

export default async function LearnLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isLearner, isAdminUser, isParent } = await spaceContext(uni);
  if (!isLearner) redirect(isAdminUser ? `/${uni}/admin` : "/");

  const parentOnly = isParent && !actor.assignments.some((a) => a.role === "student" || a.role === "alumni");

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-28 sm:px-6 sm:pb-12">
      <header className="flex items-center justify-between py-5">
        <Link href={`/${uni}/learn`} className="flex items-center gap-3">
          <Logo height={28} />
          <span className="hidden border-l border-line pl-3 text-[13px] text-muted sm:inline">{university.name}</span>
        </Link>
        <div className="flex items-center gap-3 text-[13px]">
          {isAdminUser && (
            <Link className="text-brand" href={`/${uni}/admin`}>
              Admin panel
            </Link>
          )}
          <details className="relative">
            <summary className="list-none cursor-pointer">
              <Avatar name={actor.name} size={34} />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-48 rounded-2xl border border-line bg-surface p-3 text-[13px]">
              <div className="font-medium">{actor.name}</div>
              <div className="mb-2 truncate text-muted">{actor.email}</div>
              <ul className="mb-3 space-y-1.5 border-y border-line py-2">
                {!parentOnly &&
                  [
                    ["assignments", "Assignments"],
                    ["leaderboard", "Leaderboard"],
                    ["certificates", "Certificates"],
                    ["invoices", "Invoices"],
                  ].map(([href, label]) => (
                    <li key={href}>
                      <Link href={`/${uni}/learn/${href}`} className="text-ink hover:text-brand">
                        {label}
                      </Link>
                    </li>
                  ))}
                <li>
                  <Link href={`/${uni}/learn/settings/notifications`} className="text-ink hover:text-brand">
                    Notification settings
                  </Link>
                </li>
                <li>
                  <Link href={`/${uni}/profile`} className="text-ink hover:text-brand">
                    Your profile
                  </Link>
                </li>
              </ul>
              <form action={logout}>
                <button className="text-brand">Sign out</button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <LearnNav base={`/${uni}/learn`} parentOnly={parentOnly} />
      <main>{children}</main>
    </div>
  );
}
