import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { signOut } from "@/server/auth/session";
import { ACCESS_LABEL, menuFor } from "@/server/authz/menu";
import { isActive } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { exitSupportMode } from "@/server/services/support";

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isAdminUser, isLearner } = await spaceContext(uni);
  if (!isAdminUser) redirect(`/${uni}/learn`);

  const base = `/${uni}/admin`;
  const sections = menuFor(actor, university.id).map((s) => ({ ...s, access: ACCESS_LABEL[s.access] }));
  const now = new Date();
  const roleText = [
    ...new Set(actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id).map((a) => ROLE_LABELS[a.role])),
  ].join(" · ");

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }
  async function leaveSupport() {
    "use server";
    if (actor.supportSessionId) await exitSupportMode(actor, actor.supportSessionId);
    redirect("/platform");
  }

  return (
    <div className="min-h-dvh">
      {actor.supportSessionId && (
        <div className="flex items-center justify-center gap-3 bg-warn-soft px-4 py-2 text-sm text-warn">
          <span>Support mode: everything you do here is logged.</span>
          <form action={leaveSupport}>
            <button className="font-medium underline">Leave support mode</button>
          </form>
        </div>
      )}
      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-line bg-surface px-3 py-5 md:block">
          <Link href={base} className="mb-6 block px-3">
            <div className="text-[18px] font-semibold tracking-tight text-brand">zinny</div>
            <div className="truncate text-[13px] text-muted">{university.name}</div>
          </Link>
          <AdminNav base={base} sections={sections} />
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-4 border-b border-line bg-surface/80 px-6 py-3 backdrop-blur">
            <details className="md:hidden">
              <summary className="cursor-pointer text-sm font-medium text-brand">Menu</summary>
              <div className="absolute left-0 right-0 z-10 mt-2 border-b border-line bg-surface p-4 shadow-sm">
                <AdminNav base={base} sections={sections} />
              </div>
            </details>
            <div className="hidden text-sm text-muted md:block">{roleText}</div>
            <div className="flex items-center gap-4 text-sm">
              {isLearner && (
                <Link href={`/${uni}/learn`} className="text-brand">
                  Learner app
                </Link>
              )}
              <span className="font-medium">{actor.name}</span>
              <form action={logout}>
                <button className="text-muted hover:text-ink">Sign out</button>
              </form>
            </div>
          </header>
          <main className="px-6 py-8 lg:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
