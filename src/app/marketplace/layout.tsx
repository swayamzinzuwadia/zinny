import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { AccountMenu, type AccountLink } from "@/app/[uni]/learn/account-menu";
import { loadActor } from "@/server/actor";
import { currentUserId, homeSpacesFor, signOut } from "@/server/auth/session";
import { display } from "@/modules/marketing/fonts";

/** Anyone can browse the marketplace. Buying and My library ask the visitor to sign in. */
export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const userId = await currentUserId();
  const [person, spaces] = userId ? await Promise.all([loadActor(userId, null), homeSpacesFor(userId)]) : [null, []];

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
          <Link href={person ? "/marketplace" : "/"} className="flex shrink-0 items-center">
            <Logo height={26} />
          </Link>
          <nav aria-label="Marketplace" className="flex min-w-0 gap-1 text-[14px]">
            <Link href="/marketplace" className="rounded-full px-3 py-2 whitespace-nowrap text-muted hover:bg-surface hover:text-ink">
              Marketplace
            </Link>
            {person && (
              <Link href="/marketplace/library" className="hidden rounded-full px-3 py-2 whitespace-nowrap text-muted hover:bg-surface hover:text-ink min-[400px]:block">
                My library
              </Link>
            )}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 text-[14px]">
            {person ? (
              <AccountMenu name={person.name} email={person.email} links={links} logout={logout} />
            ) : (
              <>
                <Link href="/login?next=/marketplace" className="hidden rounded-full px-3 py-2 whitespace-nowrap text-ink hover:text-brand min-[360px]:block">
                  Sign in
                </Link>
                <Link href="/signup" className="rounded-full bg-brand px-4 py-2 font-medium whitespace-nowrap text-canvas hover:bg-brand-strong">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">{children}</main>
    </div>
  );
}
