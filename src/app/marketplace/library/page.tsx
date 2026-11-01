import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Empty, Notice } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { LibraryCard } from "@/modules/marketplace/components/library";
import { marketplaceAccess, myLibrary } from "@/modules/marketplace/service";

export const metadata = { title: "My library" };
export const dynamic = "force-dynamic";

/** Everything this person has bought and paid for, from every institute. */
export default async function Library({ searchParams }: { searchParams: Promise<{ bought?: string }> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace/library");
  const [items, { canShop }] = await Promise.all([myLibrary(userId), marketplaceAccess(userId)]);

  return (
    <>
      <h1 className="text-[clamp(2.25rem,6vw,3.25rem)] leading-[1.05] font-medium">My library</h1>
      <p className="mt-3 text-[16px] text-muted">Courses and lectures you&apos;ve bought. They show here once your payment is confirmed.</p>

      {sp.bought && items.length > 0 && (
        <div className="mt-6">
          <Notice>Payment confirmed. {items[0].title} is ready to watch.</Notice>
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-8">
          <Empty title="Nothing here yet">
            {canShop ? (
              <div className="mt-3">
                <ButtonLink href="/marketplace">Browse the marketplace</ButtonLink>
              </div>
            ) : (
              <Link href="/" className="text-brand">
                Back to your space
              </Link>
            )}
          </Empty>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <LibraryCard key={item.orderId} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
