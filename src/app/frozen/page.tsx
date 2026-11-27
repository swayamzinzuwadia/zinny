import { ButtonLink } from "@/components/ui";
import { universityBySlug } from "@/server/context";
import { OnboardingShell } from "@/modules/onboarding/components/shell";

export const metadata = { title: "Temporarily unavailable" };

/**
 * Where spaceContext sends students and staff of a frozen institute: its free trial ended
 * before it chose a plan. Nothing is deleted; it opens again as soon as the institute pays.
 */
export default async function Frozen({ searchParams }: { searchParams: Promise<{ uni?: string }> }) {
  const { uni } = await searchParams;
  const university = uni ? await universityBySlug(uni) : null;
  const name = university?.name ?? "This institute";
  return (
    <OnboardingShell signIn={false}>
      <div className="mx-auto max-w-lg pt-6 sm:pt-12">
        <span className="inline-flex items-center gap-2 rounded-full bg-gold-soft px-3 py-1 text-[13px] font-medium text-gold-strong">
          <span className="now-dot h-2 w-2 rounded-full bg-gold" aria-hidden />
          Temporarily unavailable
        </span>
        <h1 className="mt-5 text-[clamp(2rem,6vw,2.8rem)] leading-[1.08] font-medium tracking-[-0.02em]">{name} is paused for now</h1>
        <p className="mt-4 text-[16px] leading-relaxed text-muted">
          Its Zinny space isn&apos;t open at the moment. Your courses, marks and work are all kept, and everything will be here when it opens again. Ask your institute when that will be.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/marketplace" variant="secondary" icon="forward">
            Go to the marketplace
          </ButtonLink>
          <ButtonLink href="/login?uni=" variant="ghost" icon="forward">
            Sign in to another institute
          </ButtonLink>
        </div>
      </div>
    </OnboardingShell>
  );
}
