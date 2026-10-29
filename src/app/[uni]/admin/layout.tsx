import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { SidebarAccount, SidebarLink } from "@/components/sidebar-account";
import { Logo } from "@/components/ui";
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
  const roles = [
    ...new Set(actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id).map((a) => ROLE_LABELS[a.role])),
  ];

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

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href={base} className="mb-6 block px-3 pt-1">
        <Logo height={28} tone="cream" />
        <div className="mt-2 truncate text-[13px] text-canvas/55">{university.name}</div>
      </Link>
      <div className="sidebar-scroll -mr-2 flex-1 overflow-y-auto py-2 pr-1">
        <AdminNav base={base} sections={sections} />
      </div>
      <SidebarAccount name={actor.name} roles={roles.join(", ")} logout={logout}>
        <SidebarLink href={`/${uni}/profile`}>Your profile</SidebarLink>
        {/* Every staff member reaches their own "My notifications" here; admins also get the Settings item. */}
        <SidebarLink href={`/${uni}/admin/settings/notifications`}>Notifications</SidebarLink>
        {isLearner && (
          <SidebarLink href={`/${uni}/learn`} gold>
            Learner app
          </SidebarLink>
        )}
      </SidebarAccount>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {actor.supportSessionId && (
        <div className="flex items-center justify-center gap-3 bg-gold px-4 py-2 text-[13px] text-brand-deep">
          <span>Support mode is on. Everything you do here is logged.</span>
          <form action={leaveSupport}>
            <button className="font-semibold underline underline-offset-2">Leave support mode</button>
          </form>
        </div>
      )}
      <div className="flex">
        {/* The aside is the full-height green column (flex stretch makes it as tall as the page); only its contents stick. */}
        <aside className="hidden w-[264px] shrink-0 bg-brand-deep md:block">
          <div className="sticky top-0 h-dvh px-3 py-6">{sidebar}</div>
        </aside>
        <div className="min-w-0 flex-1">
          <details className="group border-b border-line bg-brand-deep md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
              <Logo height={26} tone="cream" />
              <span className="text-[13px] text-canvas/80">Menu</span>
            </summary>
            <div className="max-h-[75dvh] overflow-y-auto px-3 pb-4">{sidebar}</div>
          </details>
          <main className="mx-auto max-w-[1280px] px-5 py-8 lg:px-10 lg:py-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
