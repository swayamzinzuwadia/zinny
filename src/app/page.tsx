import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { loadActor } from "@/server/actor";
import { currentUserId, homeSpacesFor, signOut } from "@/server/auth/session";
import { canPlatform } from "@/server/authz/engine";
import { ADMIN_PANEL_ROLES, ROLE_LABELS } from "@/server/authz/roles";
import type { RoleName } from "@/db/schema";
import { LandingPage } from "@/modules/marketing/LandingPage";
import { marketplaceAccess } from "@/modules/marketplace/service";

export const metadata: Metadata = {
  title: { absolute: "Zinny · The whole institute, in order" },
  description:
    "Courses, batches, fees and certificates in one private space for every institute, and a marketplace where students buy recorded lessons directly from them.",
  openGraph: {
    title: "Zinny · The whole institute, in order",
    description: "One private space for every institute, and a marketplace of recorded courses and lectures sold directly by institutes.",
    type: "website",
  },
};

/** Signed out: the landing page. After sign-in: go straight to the only space, or pick one. */
export default async function Home() {
  const userId = await currentUserId();
  if (!userId) return <LandingPage />;
  const [spaces, platform] = await Promise.all([homeSpacesFor(userId), loadActor(userId, null)]);
  const isStaff = canPlatform(platform, "platform.support_mode") || canPlatform(platform, "platform.manage_universities");
  if (spaces.length === 0 && !isStaff && (await marketplaceAccess(userId)).canShop) redirect("/marketplace");

  const destinations = spaces.map((s) => ({
    href: `/${s.slug}/${s.roles.some((r) => ADMIN_PANEL_ROLES.has(r as RoleName)) ? "admin" : "learn"}`,
    name: s.name,
    roles: s.roles.map((r) => ROLE_LABELS[r as RoleName]).join(", "),
  }));
  if (isStaff && destinations.length === 0) redirect("/platform");
  if (!isStaff && destinations.length === 1) redirect(destinations[0].href);

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-[28px] font-semibold tracking-tight">Where do you want to go?</h1>
      <div className="mt-6 grid gap-3">
        {isStaff && (
          <Link href="/platform">
            <Card className="hover:border-brand">
              <div className="font-medium">Zinny team panel</div>
              <div className="text-sm text-muted">Institutes, licences and support mode</div>
            </Card>
          </Link>
        )}
        {destinations.map((d) => (
          <Link key={d.href} href={d.href}>
            <Card className="hover:border-brand">
              <div className="font-medium">{d.name}</div>
              <div className="text-sm text-muted">{d.roles}</div>
            </Card>
          </Link>
        ))}
        {destinations.length === 0 && !isStaff && <p className="text-muted">You don&apos;t have access to any institute yet.</p>}
      </div>
      <form action={logout} className="mt-8">
        <button className="text-sm text-muted hover:text-ink">Sign out</button>
      </form>
    </main>
  );
}
