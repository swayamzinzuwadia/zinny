import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { AccountMenu, type AccountLink } from "@/app/[uni]/learn/account-menu";
import { loadActor } from "@/server/actor";
import { currentUserId, homeSpacesFor, signOut } from "@/server/auth/session";
import { display } from "@/modules/marketing/fonts";

/** The marketplace is for signed-in people, so buying and My library always know who is asking. */
export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace");
  const [person, spaces] = await Promise.all([loadActor(userId, null), homeSpacesFor(userId)]);

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  const links: AccountLink[] = spaces.map((s) => ({ href: `/${s.slug}/learn`, label: s.name }));

  return (
    <div className={`display-headings min-h-dvh pb-16 ${display.variable}`}>
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:gap-6 sm:px-6">
          <Link href="/marketplace" className="flex shrink-0 items-center">
            <Logo height={26} />
          </Link>
          <nav aria-label="Marketplace" className="flex min-w-0 gap-1 text-[14px]">
            <Link href="/marketplace" className="rounded-full px-3 py-2 whitespace-nowrap text-muted hover:bg-surface hover:text-ink">
              Marketplace
            </Link>
            <Link href="/marketplace/library" className="rounded-full px-3 py-2 whitespace-nowrap text-muted hover:bg-surface hover:text-ink">
              My library
            </Link>
          </nav>
          <div className="ml-auto shrink-0">
            <AccountMenu name={person.name} email={person.email} links={links} logout={logout} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">{children}</main>
    </div>
  );
}
