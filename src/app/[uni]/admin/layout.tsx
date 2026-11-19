import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { PageTrail, type TrailParent } from "@/components/page-trail";
import { SidebarAccount, SidebarLink } from "@/components/sidebar-account";
import { Logo } from "@/components/ui";
import { signOut } from "@/server/auth/session";
import { ACCESS_LABEL, sidebarFor, sidebarLinks } from "@/server/authz/menu";
import { can, isActive } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { exitSupportMode } from "@/server/services/support";
import { getPreferences } from "@/modules/notifications-delivery/service";
import { ImpersonationBanner } from "@/modules/zinny-team-panel/components/impersonation-banner";

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isAdminUser, isLearner } = await spaceContext(uni);
  if (!isAdminUser) redirect(`/${uni}/learn`);

  const base = `/${uni}/admin`;
  const nav = sidebarFor(actor, university.id);
  // Access is shown only where it is less than full.
  const groups = nav.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, access: i.access && i.access !== "full" ? ACCESS_LABEL[i.access] : undefined })) }));
  // Every page below a menu link leads back to it.
  const links = sidebarLinks(nav).filter((l) => l.href !== "");
  // Finding is for people who have courses or people to find.
  const canFind = links.some((l) => ["/products/courses", "/users/students", "/users/staff"].includes(l.href));
  const trail: TrailParent[] = links.map((l) => ({ prefix: l.href, href: l.href, label: l.label }));
  const now = new Date();
  const roles = [
    ...new Set(actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id).map((a) => a.label ?? ROLE_LABELS[a.role])),
  ];
  // Staff with no notifications to choose from don't get a link to an empty page.
  const notificationsLink =
    !links.some((l) => l.href === "/settings/notifications") &&
    (can(actor, "settings.manage", { universityId: university.id }) ||
      (await getPreferences(actor, actor.userId).then(
        (p) => p.rows.length > 0,
        () => false,
      )));

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
      <Link href={base} className="mb-4 hidden px-3 pt-1 lg:block">
        <Logo height={28} tone="cream" />
        <div className="mt-2 truncate text-[13px] text-canvas/55">{university.name}</div>
      </Link>
      {canFind && (
        // One box for any student, member of staff, course or batch; one match goes straight to it.
        <form action={`${base}/find`} role="search" className="mb-3 px-1">
          <input
            type="search"
            name="q"
            aria-label="Find a student, course or batch"
            placeholder="Find a student, course or batch"
            className="h-9 w-full rounded-xl border border-canvas/15 bg-canvas/[0.08] px-3 text-[13.5px] text-canvas outline-none [transition-property:border-color,background-color] duration-150 placeholder:text-canvas/45 focus:border-gold/70 focus:bg-canvas/[0.12]"
          />
        </form>
      )}
      <div className="sidebar-scroll -mr-2 flex-1 overflow-y-auto py-1 pr-1">
        <AdminNav base={base} groups={groups} />
      </div>
      <SidebarAccount name={actor.name} roles={roles.join(", ")} logout={logout}>
        <SidebarLink href={`/${uni}/profile`}>Your profile</SidebarLink>
        {/* Staff reach their own "My notifications" here; admins have Notifications under Settings in the menu. */}
        {notificationsLink && <SidebarLink href={`/${uni}/admin/settings/notifications`}>Notifications</SidebarLink>}
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
      <ImpersonationBanner slug={uni} />
      {actor.supportSessionId && (
        // Stays in view while scrolling, so nobody forgets they're inside someone else's institute.
        <div role="status" className="sticky top-0 z-30 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gold px-4 py-2 text-[13px] text-brand-deep">
          <span>
            You are in support mode at <span className="font-semibold">{university.name}</span>. Everything you do here is logged with your name.
          </span>
          <Link href="/platform" className="font-semibold underline underline-offset-2">
            Back to the Zinny team panel
          </Link>
          <form action={leaveSupport}>
            <button className="font-semibold underline underline-offset-2">Leave support mode</button>
          </form>
        </div>
      )}
      <div className="flex">
        {/* The aside is the full-height green column (flex stretch makes it as tall as the page); only its contents stick. */}
        <aside className="hidden w-[264px] shrink-0 bg-brand-deep lg:block">
          <div className="sticky top-0 h-dvh px-3 py-6">{sidebar}</div>
        </aside>
        <div className="min-w-0 flex-1">
          <details className="group border-b border-line bg-brand-deep lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
              <Logo height={26} tone="cream" />
              <span className="text-[13px] text-canvas/80">Menu</span>
            </summary>
            <div className="max-h-[75dvh] overflow-y-auto px-3 pb-4">{sidebar}</div>
          </details>
          <main className="mx-auto max-w-[1280px] px-5 py-8 lg:px-10 lg:py-10">
            <PageTrail base={base} parents={trail} />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
