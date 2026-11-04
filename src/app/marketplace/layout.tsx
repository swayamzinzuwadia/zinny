import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { AccountMenu, type AccountLink } from "@/app/[uni]/learn/account-menu";
import { cartCount } from "@/modules/marketplace/cart";
import { CartLink } from "@/modules/marketplace/components/cart-link";
import { marketplaceAccess } from "@/modules/marketplace/service";
import { loadActor } from "@/server/actor";
import { currentUserId, homeSpacesFor, signOut } from "@/server/auth/session";
import { display } from "@/modules/marketing/fonts";

const navLink = "rounded-full px-2.5 py-2 sm:px-3 whitespace-nowrap text-canvas/75 [transition-property:color,background-color] duration-150 hover:bg-canvas/10 hover:text-canvas";

/** Anyone can browse the marketplace. Buying and My library ask the visitor to sign in. Pages set their own width, so a shop front can run edge to edge. */
export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const userId = await currentUserId();
  const [person, spaces, shopper] = userId
    ? await Promise.all([loadActor(userId, null), homeSpacesFor(userId), marketplaceAccess(userId).then((a) => (a.canShop ? cartCount(userId) : null))])
    : [null, [], null];

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  // Each institute they belong to, and a way to join another with its code.
  const links: AccountLink[] = [...spaces.map((s) => ({ href: `/${s.slug}/learn`, label: s.name })), { href: "/join", label: "Join an institute" }];

  return (
    <div
      id="marketplace-root"
      className={`display-headings flex min-h-dvh flex-col bg-canvas selection:bg-gold selection:text-brand-deep [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-gold ${display.variable}`}
    >
      <header className="sticky top-0 z-30 bg-brand-deep text-canvas shadow-[0_1px_0_rgb(250_246_234/0.08)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <Link href={person ? "/marketplace" : "/"} className="flex shrink-0 items-center">
            <Logo height={26} tone="cream" />
          </Link>
          <nav aria-label="Marketplace" className="flex min-w-0 gap-0.5 text-[14px]">
            <Link href="/marketplace" className={navLink}>
              Marketplace
            </Link>
            {person && (
              <Link href="/marketplace/library" className={navLink}>
                My library
              </Link>
            )}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 text-[14px]">
            {person ? (
              <>
                {shopper !== null && <CartLink count={shopper} />}
                <AccountMenu name={person.name} email={person.email} links={links} logout={logout} />
              </>
            ) : (
              <>
                <Link href="/login?next=/marketplace" className={`${navLink} hidden min-[360px]:block`}>
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-full bg-gold px-4 py-2 font-medium whitespace-nowrap text-brand-deep [transition-property:background-color] duration-150 hover:bg-canvas"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 pb-20">{children}</main>
      {/* The pitch to institutes is for visitors; people shopping or watching don't need it. */}
      {!person && (
        <footer className="bg-brand-deep text-canvas">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="max-w-md">
              <h2 className="text-[26px] leading-tight font-semibold">Run an institute?</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-canvas/70">Put your recorded courses on these shelves and sell them to learners everywhere, straight from your own Zinny space.</p>
            </div>
            <Link
              href="/book-a-demo"
              className="self-start rounded-full bg-gold px-5 py-2.5 text-[15px] font-medium text-brand-deep [transition-property:background-color] duration-150 hover:bg-canvas sm:self-auto"
            >
              Book a demo
            </Link>
          </div>
        </footer>
      )}
    </div>
  );
}
