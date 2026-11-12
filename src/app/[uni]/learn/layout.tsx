import Link from "next/link";
import { redirect } from "next/navigation";
import { PageTrail } from "@/components/page-trail";
import { Logo } from "@/components/ui";
import { signOut } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { hasLiveSeat, marketplaceAccess } from "@/modules/marketplace/service";
import { hasInvoices } from "@/modules/payments/invoices";
import { stopViewAsAction } from "@/modules/zinny-team-panel/actions";
import { AccountMenu, type AccountLink } from "./account-menu";
import { LEARN_PARENTS, LearnBottomBar, LearnTabs } from "./nav";
import { learnView } from "./view";
import { ViewAsBar } from "./view-as-bar";
import { ImpersonationBanner } from "@/modules/zinny-team-panel/components/impersonation-banner";

export default async function LearnLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isLearner, isAdminUser, isParent } = await spaceContext(uni);
  if (!isLearner) redirect(isAdminUser ? `/${uni}/admin` : "/");

  const view = learnView(actor, isParent);
  // Someone who only bought from this institute: its space is just the way into those purchases.
  const buyerOnly = view === "buyer";
  const [{ canShop }, invoices, buyerLive] = await Promise.all([
    marketplaceAccess(actor.userId),
    view === "parent" ? false : hasInvoices(actor),
    // A buyer with a seat in a live batch also gets the timetable, where their classes and join links are.
    buyerOnly ? hasLiveSeat(actor.userId, university.id) : false,
  ]);
  const base = `/${uni}/learn`;

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  // On phones the tab bar holds four sections, so the rest live in this menu; wider screens show them as tabs.
  const links: AccountLink[] = [
    ...(view === "student"
      ? [
          // Same order as the tabs on wider screens.
          { href: `${base}/assignments`, label: "Assignments", phoneOnly: true },
          { href: `${base}/tests`, label: "Tests", phoneOnly: true },
          { href: `${base}/polls`, label: "Polls", phoneOnly: true },
          { href: `${base}/leaderboard`, label: "Leaderboard", phoneOnly: true },
          { href: `${base}/certificates`, label: "Certificates", phoneOnly: true },
          ...(canShop
            ? [
                { href: "/marketplace/library", label: "My library", phoneOnly: true },
                { href: "/marketplace", label: "Marketplace", phoneOnly: true },
              ]
            : []),
        ]
      : []),
    // Institute courses are free for their students, so most learners never have an invoice.
    ...(invoices ? [{ href: `${base}/invoices`, label: "Invoices" }] : []),
    // A parent gets no notifications of their own to set up yet.
    ...(view === "parent" ? [] : [{ href: `${base}/settings/notifications`, label: "Notification settings" }]),
    { href: `/${uni}/profile`, label: "Your profile" },
    ...(isAdminUser ? [{ href: `/${uni}/admin`, label: "Admin panel" }] : []),
  ];

  return (
    <div className={view === "parent" ? "min-h-dvh pb-12" : "min-h-dvh pb-28 sm:pb-12"}>
      <ImpersonationBanner slug={uni} />
      {actor.viewedBy && <ViewAsBar name={actor.name} stop={stopViewAsAction} />}
      <header data-learn-chrome className={`sticky z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md ${actor.viewedBy ? "top-9" : "top-0"}`}>
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:gap-6 sm:px-6">
          <Link href={buyerOnly ? "/marketplace/library" : base} className="flex min-w-0 items-center gap-3">
            <span className="shrink-0">
              <Logo height={26} />
            </span>
            <span className="min-w-0 max-w-[11rem] truncate border-l border-line pl-3 text-[13px] text-muted">{university.name}</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-[13px]">
            {isAdminUser && (
              <Link className="hidden rounded-full px-3 py-1.5 text-brand ring-1 ring-line hover:bg-surface sm:inline-block" href={`/${uni}/admin`}>
                Admin panel
              </Link>
            )}
            <AccountMenu name={actor.name} email={actor.email} links={links} logout={logout} />
          </div>
        </div>
        {/* The sections get a row of their own: next to the logo, nine tabs don't fit a laptop screen. */}
        <div className="mx-auto hidden max-w-6xl px-4 pb-2.5 sm:block sm:px-6">
          <LearnTabs base={base} view={view} canShop={canShop} buyerLive={buyerLive} />
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        {!buyerOnly && (
          <div data-learn-chrome>
            <PageTrail base={base} parents={LEARN_PARENTS} />
          </div>
        )}
        <main>{children}</main>
      </div>
      <LearnBottomBar base={base} view={view} canShop={canShop} buyerLive={buyerLive} />
    </div>
  );
}
