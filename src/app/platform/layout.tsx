import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CollapsibleAside, SidebarToggle } from "@/components/collapsible-sidebar";
import { modeFromCookie } from "@/components/sidebar-mode";
import { SidebarAccount } from "@/components/sidebar-account";
import { Logo, LogoMark } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { signOut } from "@/server/auth/session";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { leaveSupportAction } from "@/modules/zinny-team-panel/actions";
import { ImpersonationBanner } from "@/modules/zinny-team-panel/components/impersonation-banner";
import { PlatformNav } from "@/modules/zinny-team-panel/components/platform-nav";
import { PlatformTopbar } from "@/modules/zinny-team-panel/components/platform-topbar";
import { isSuperAdmin, isZinnyTeam, sidebarFor, sidebarLinks } from "@/modules/zinny-team-panel/lib/access";
import { PLATFORM_ROLE_LABELS, isPlatformRole } from "@/modules/zinny-team-panel/lib/constants";
import { timeUntil } from "@/modules/zinny-team-panel/lib/format";
import { activeSessions } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: { default: "Zinny team", template: "%s · Zinny team" } };

/** The Zinny team panel (PRD page 2): a separate super-admin panel, outside any university. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const actor = await platformContext();
  // People without a Zinny team role go back to the space picker.
  if (!isZinnyTeam(actor)) redirect("/");

  const groups = sidebarFor(actor);
  const sidebarMode = modeFromCookie((await cookies()).get("zinny-sb-platform")?.value);
  // Every page below a menu link leads back to it, from the top bar.
  const parents = sidebarLinks(groups)
    .filter((l) => l.href !== "")
    .map((l) => ({ prefix: l.href, href: l.href, label: l.label }));
  const now = new Date();
  const roles = [
    ...new Set(
      actor.assignments
        .filter((a) => a.scopeType === "platform" && a.startsAt <= now && (!a.endsAt || a.endsAt > now) && isPlatformRole(a.role))
        .map((a) => a.label ?? PLATFORM_ROLE_LABELS[a.role as keyof typeof PLATFORM_ROLE_LABELS]),
    ),
  ];
  const mine = canPlatform(actor, "platform.support_mode") ? (await activeSessions(actor)).filter((s) => s.staffUserId === actor.userId) : [];

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/platform" aria-label="Zinny team home" className="zs-head mb-4 hidden px-3 pt-1 md:block">
        <span className="zs-wide-only block">
          <Logo height={28} tone="cream" />
          <span className="mt-2 block text-[13px] text-canvas/55">Zinny team</span>
        </span>
        <span className="zs-rail-only">
          <LogoMark size={32} />
        </span>
      </Link>
      <div className="sidebar-scroll -mr-2 flex-1 overflow-y-auto py-1 pr-1">
        <PlatformNav groups={groups} />
      </div>
      <SidebarToggle />
      <SidebarAccount name={actor.name} roles={roles.join(", ")} logout={logout} />
    </div>
  );

  return (
    <div className="min-h-dvh">
      <ImpersonationBanner />
      {mine.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gold px-4 py-2 text-[13px] text-brand-deep">
          <span>
            You are in support mode at {s.universityName}. It ends in {timeUntil(s.expiresAt)} unless you leave first.
          </span>
          <a href={`/${s.slug}/admin`} className="font-semibold underline underline-offset-2">
            Go to {s.universityName}
          </a>
          <ActionForm action={leaveSupportAction} className="inline">
            <input type="hidden" name="sessionId" value={s.id} />
            <button className="font-semibold underline underline-offset-2">Leave support mode</button>
          </ActionForm>
        </div>
      ))}
      <div className="flex">
        <CollapsibleAside cookie="zinny-sb-platform" initial={sidebarMode}>
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
          <PlatformTopbar
            parents={parents}
            name={actor.name}
            email={actor.email}
            roles={roles.join(", ")}
            canSearch={canPlatform(actor, "platform.manage_universities")}
            links={isSuperAdmin(actor) ? [{ label: "Team", href: "/platform/team" }] : []}
            logout={logout}
          />
          <main className="mx-auto max-w-[1280px] px-5 py-8 lg:px-10 lg:py-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
