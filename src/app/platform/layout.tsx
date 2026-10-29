import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Logo } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { signOut } from "@/server/auth/session";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { leaveSupportAction } from "@/modules/zinny-team-panel/actions";
import { PlatformNav } from "@/modules/zinny-team-panel/components/platform-nav";
import { isZinnyTeam, navFor } from "@/modules/zinny-team-panel/lib/access";
import { PLATFORM_ROLE_LABELS, isPlatformRole } from "@/modules/zinny-team-panel/lib/constants";
import { timeUntil } from "@/modules/zinny-team-panel/lib/format";
import { activeSessions } from "@/modules/zinny-team-panel/services/support";

export const metadata = { title: { default: "Zinny team", template: "%s · Zinny team" } };

/** The Zinny team panel (PRD page 2): a separate super-admin panel, outside any university. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const actor = await platformContext();
  // People without a Zinny team role go back to the space picker.
  if (!isZinnyTeam(actor)) redirect("/");

  const sections = navFor(actor);
  const now = new Date();
  const roles = [
    ...new Set(
      actor.assignments
        .filter((a) => a.scopeType === "platform" && a.startsAt <= now && (!a.endsAt || a.endsAt > now) && isPlatformRole(a.role))
        .map((a) => PLATFORM_ROLE_LABELS[a.role as keyof typeof PLATFORM_ROLE_LABELS]),
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
      <Link href="/platform" className="mb-7 block px-3 pt-1">
        <Logo height={30} tone="cream" />
        <div className="mt-2.5 text-[13px] text-canvas/60">Zinny team</div>
      </Link>
      <div className="flex-1 overflow-y-auto pb-6">
        <PlatformNav sections={sections} />
      </div>
      <div className="mt-2 rounded-2xl bg-canvas/[0.07] p-3">
        <div className="flex items-center gap-3">
          <Avatar name={actor.name} size={34} />
          <div className="min-w-0 text-[13px] leading-snug">
            <div className="truncate font-medium text-canvas">{actor.name}</div>
            <div className="truncate text-canvas/60">{roles.join(", ")}</div>
          </div>
        </div>
        <div className="mt-3 flex justify-end text-[12.5px]">
          <form action={logout}>
            <button className="text-canvas/60 hover:text-canvas">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
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
