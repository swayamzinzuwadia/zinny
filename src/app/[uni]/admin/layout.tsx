import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { Avatar, Logo } from "@/components/ui";
import { signOut } from "@/server/auth/session";
import { ACCESS_LABEL, menuFor } from "@/server/authz/menu";
import { isActive } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { exitSupportMode } from "@/server/services/support";

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university, isAdminUser, isLearner } = await spaceContext(uni);
  if (!isAdminUser) redirect(`/${uni}/learn`);

  const base = `/${uni}/admin`;
  const sections = menuFor(actor, university.id).map((s) => ({ ...s, access: ACCESS_LABEL[s.access] }));
  const now = new Date();
  const roles = [
    ...new Set(actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id).map((a) => ROLE_LABELS[a.role])),
  ];

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
      <Link href={base} className="mb-7 block px-3 pt-1">
        <Logo height={30} tone="cream" />
        <div className="mt-2.5 truncate text-[13px] text-canvas/60">{university.name}</div>
      </Link>
      <div className="flex-1 overflow-y-auto pb-6">
        <AdminNav base={base} sections={sections} />
      </div>
      <div className="mt-2 rounded-2xl bg-canvas/[0.07] p-3">
        <div className="flex items-center gap-3">
          <Avatar name={actor.name} size={34} />
          <div className="min-w-0 text-[13px] leading-snug">
            <div className="truncate font-medium text-canvas">{actor.name}</div>
            <div className="truncate text-canvas/60">{roles.join(", ")}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-[12.5px]">
          {isLearner ? (
            <Link href={`/${uni}/learn`} className="text-gold hover:underline">
              Learner app
            </Link>
          ) : (
            <span />
          )}
          <form action={logout}>
            <button className="text-canvas/60 hover:text-canvas">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {actor.supportSessionId && (
        <div className="flex items-center justify-center gap-3 bg-gold px-4 py-2 text-[13px] text-brand-deep">
          <span>Support mode is on. Everything you do here is logged.</span>
          <form action={leaveSupport}>
            <button className="font-semibold underline underline-offset-2">Leave support mode</button>
          </form>
        </div>
      )}
      <div className="flex">
        <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 bg-brand-deep px-3 py-6 md:block">{sidebar}</aside>
        <div className="min-w-0 flex-1">
          <details className="group border-b border-line bg-brand-deep md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
              <Logo height={26} tone="cream" />
              <span className="text-[13px] text-canvas/80">Menu</span>
            </summary>
            <div className="max-h-[75dvh] overflow-y-auto px-3 pb-4">{sidebar}</div>
          </details>
          <main className="mx-auto max-w-[1280px] px-5 py-8 lg:px-10 lg:py-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
