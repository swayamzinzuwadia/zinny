import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { CollapsibleAside, SidebarToggle } from "@/components/collapsible-sidebar";
import { modeFromCookie } from "@/components/sidebar-mode";
import { PageTrail, type TrailParent } from "@/components/page-trail";
import { SidebarAccount, SidebarLink } from "@/components/sidebar-account";
import { Logo, LogoMark } from "@/components/ui";
import { signOut } from "@/server/auth/session";
import { ACCESS_LABEL, sidebarFor, sidebarLinks } from "@/server/authz/menu";
import { can, isActive } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { exitSupportMode } from "@/server/services/support";
import { getPreferences } from "@/modules/notifications-delivery/service";
import { ImpersonationBanner } from "@/modules/zinny-team-panel/components/impersonation-banner";
import { TrialBanner } from "@/modules/onboarding/components/trial-banner";
import { LicenceBanner } from "@/modules/zinny-team-panel/components/licence-banner";
import { formatDate, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { ownLicenceReminder } from "@/modules/zinny-team-panel/services/universities";

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

  // Owners and admins are reminded when the Zinny licence is about to end. A failed read must never block the panel.
  const today = todayIST();
  const reminder = can(actor, "settings.manage", { universityId: university.id })
    ? await ownLicenceReminder(actor, university.id, today).catch(() => null)
    : null;
  const sidebarMode = modeFromCookie((await cookies()).get("zinny-sb-admin")?.value);

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
      <Link href={base} aria-label={`${university.name} dashboard`} className="zs-head mb-4 hidden px-3 pt-1 md:block">
        <span className="zs-wide-only block">
          <Logo height={28} tone="cream" />
          <span className="mt-2 block truncate text-[13px] text-canvas/55">{university.name}</span>
        </span>
        <span className="zs-rail-only">
          <LogoMark size={32} />
        </span>
      </Link>
      {canFind && (
        // One box for any student, member of staff, course or batch; one match goes straight to it.
        <form action={`${base}/find`} role="search" className="zs-label mb-3 px-1">
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
      <SidebarToggle />
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
        <CollapsibleAside cookie="zinny-sb-admin" initial={sidebarMode}>
          {sidebar}
        </CollapsibleAside>
        <div className="min-w-0 flex-1">
          <details className="group border-b border-line bg-brand-deep md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
              <Logo height={26} tone="cream" />
              <span className="text-[13px] text-canvas/80">Menu</span>
            </summary>
            <div className="max-h-[75dvh] overflow-y-auto px-3 pb-4">{sidebar}</div>
          </details>
          {reminder && (
            <LicenceBanner
              endText={formatDate(reminder.endDate)}
              daysLeft={reminder.daysLeft}
              urgent={reminder.level.urgent}
              // Renewals are agreed with the Zinny team; the settings page is where an admin starts.
              renewHref={`${base}/settings`}
              today={today}
            />
          )}
          <TrialBanner uni={uni} actor={actor} />
          <main className="mx-auto max-w-[1280px] px-5 py-8 lg:px-10 lg:py-10">
            <PageTrail base={base} parents={trail} />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
