import Link from "next/link";
import { redirect } from "next/navigation";
import { PageTrail } from "@/components/page-trail";
import { Logo } from "@/components/ui";
import { signOut } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { stopViewAsAction } from "@/modules/zinny-team-panel/actions";
import { AccountMenu, type AccountLink } from "./account-menu";
import { LEARN_PARENTS, LearnBottomBar, LearnTabs } from "./nav";
import { ViewAsBar } from "./view-as-bar";

export default async function LearnLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isLearner, isAdminUser, isParent } = await spaceContext(uni);
  if (!isLearner) redirect(isAdminUser ? `/${uni}/admin` : "/");

  const parentOnly = isParent && !actor.assignments.some((a) => a.role === "student" || a.role === "alumni");
  const base = `/${uni}/learn`;

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  // On phones the tab bar holds four sections, so the rest live in this menu; wider screens show them as tabs.
  const links: AccountLink[] = [
    ...(parentOnly
      ? []
      : [
          { href: `${base}/assignments`, label: "Assignments", phoneOnly: true },
          { href: `${base}/leaderboard`, label: "Leaderboard", phoneOnly: true },
          { href: `${base}/certificates`, label: "Certificates", phoneOnly: true },
          { href: `${base}/invoices`, label: "Invoices" },
        ]),
    { href: `${base}/settings/notifications`, label: "Notification settings" },
    { href: `/${uni}/profile`, label: "Your profile" },
    ...(isAdminUser ? [{ href: `/${uni}/admin`, label: "Admin panel" }] : []),
  ];

  return (
    <div className="min-h-dvh pb-28 sm:pb-12">
      {actor.viewedBy && <ViewAsBar name={actor.name} stop={stopViewAsAction} />}
      <header data-learn-chrome className={`sticky z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md ${actor.viewedBy ? "top-9" : "top-0"}`}>
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href={base} className="flex shrink-0 items-center gap-3">
            <Logo height={26} />
            <span className="hidden max-w-[11rem] truncate border-l border-line pl-3 text-[13px] text-muted sm:inline">{university.name}</span>
          </Link>
          <LearnTabs base={base} parentOnly={parentOnly} className="hidden lg:block" />
          <div className="ml-auto flex shrink-0 items-center gap-3 text-[13px]">
            {isAdminUser && (
              <Link className="hidden rounded-full px-3 py-1.5 text-brand ring-1 ring-line hover:bg-surface sm:inline-block" href={`/${uni}/admin`}>
                Admin panel
              </Link>
            )}
            <AccountMenu name={actor.name} email={actor.email} links={links} logout={logout} />
          </div>
        </div>
        <div className="mx-auto hidden max-w-6xl px-4 pb-2.5 sm:block sm:px-6 lg:hidden">
          <LearnTabs base={base} parentOnly={parentOnly} />
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        <div data-learn-chrome>
          <PageTrail base={base} parents={LEARN_PARENTS} />
        </div>
        <main>{children}</main>
      </div>
      <LearnBottomBar base={base} parentOnly={parentOnly} />
    </div>
  );
}
