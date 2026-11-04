import Link from "next/link";
import { Logo } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { marketplaceAccess } from "@/modules/marketplace/service";
import { LearnBottomBar, LearnTabs } from "../learn/nav";
import { learnView } from "../learn/view";

/**
 * The profile page is shared by the admin panel and the learner app, so it has its own
 * simple frame with a way back to whichever app the person uses (both, for some). A learner
 * keeps the learner app's tabs (and its tab bar on phones), so the profile feels part of it.
 */
export default async function ProfileLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isAdminUser, isLearner, isParent } = await spaceContext(uni);
  const view = learnView(actor, isParent);
  // A parent's learner app is one page, so it has no tabs to show here.
  const tabs = isLearner && !isAdminUser && view !== "parent";
  const canShop = tabs ? (await marketplaceAccess(actor.userId)).canShop : false;
  const base = `/${uni}/learn`;
  return (
    <div className={tabs ? "min-h-dvh pb-28 sm:pb-16" : "min-h-dvh pb-16"}>
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 py-5">
          <Link href={isAdminUser ? `/${uni}/admin` : isLearner ? base : "/"} className="flex min-w-0 items-center gap-3">
            <span className="shrink-0">
              <Logo height={28} />
            </span>
            <span className="min-w-0 truncate border-l border-line pl-3 text-[13px] text-muted">{university.name}</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-4 text-[14px]">
            {isAdminUser && (
              <Link href={`/${uni}/admin`} className="text-brand hover:underline">
                Admin panel
              </Link>
            )}
            {isLearner && (
              // On phones a learner has the tab bar instead.
              <Link href={base} className={tabs ? "hidden text-brand hover:underline sm:inline" : "text-brand hover:underline"}>
                Learner app
              </Link>
            )}
          </nav>
        </header>
        {tabs && <LearnTabs base={base} view={view} canShop={canShop} className="-mt-2 mb-6 hidden sm:block" />}
        <main>{children}</main>
      </div>
      {tabs && <LearnBottomBar base={base} view={view} canShop={canShop} />}
    </div>
  );
}
