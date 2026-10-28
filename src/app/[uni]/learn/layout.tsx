import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { LearnNav } from "./nav";

export default async function LearnLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isLearner, isAdminUser, isParent } = await spaceContext(uni);
  if (!isLearner) redirect(isAdminUser ? `/${uni}/admin` : "/");

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl pb-24 sm:pb-10">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href={`/${uni}/learn`}>
          <div className="text-[18px] font-semibold tracking-tight text-brand">zinny</div>
          <div className="text-xs text-muted">{university.name}</div>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {isAdminUser && (
            <Link className="text-brand" href={`/${uni}/admin`}>
              Admin panel
            </Link>
          )}
          <span className="hidden font-medium sm:inline">{actor.name}</span>
          <form action={logout}>
            <button className="text-muted">Sign out</button>
          </form>
        </div>
      </header>
      <LearnNav base={`/${uni}/learn`} parentOnly={isParent && !actor.assignments.some((a) => a.role === "student" || a.role === "alumni")} />
      <main className="px-4 sm:px-6">{children}</main>
    </div>
  );
}
