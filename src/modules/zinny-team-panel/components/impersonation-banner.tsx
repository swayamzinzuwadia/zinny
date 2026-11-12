import { impersonationView } from "../services/accounts";
import { ReturnToPanel } from "./return-to-panel";

/**
 * Shown on every screen while a Zinny Super Admin is signed in as someone, so they can't
 * forget whose account they are in. Fixed to the bottom of the window, where it covers
 * no navigation; on phones it sits above the learner app's tab bar. Renders nothing for
 * an ordinary session. `slug` is the institute the screen belongs to, when it has one.
 */
export async function ImpersonationBanner({ slug }: { slug?: string }) {
  const view = await impersonationView(slug);
  if (!view) return null;
  return (
    <div
      role="status"
      data-impersonation-banner
      className="fixed inset-x-3 bottom-[5.25rem] z-[80] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-2xl bg-gold px-4 py-2.5 text-center text-[13px] text-brand-deep shadow-lg sm:inset-x-0 sm:bottom-0 sm:rounded-none"
    >
      <span>
        You&apos;re signed in as <b>{view.name}</b> ({view.role}). Everything you do is recorded as them, with your name alongside.
      </span>
      <ReturnToPanel />
    </div>
  );
}
