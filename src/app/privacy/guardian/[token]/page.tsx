import Link from "next/link";
import { Notice } from "@/components/ui";
import { PublicShell } from "@/modules/privacy/components/public-shell";
import { GuardianConfirmForm } from "@/modules/privacy/components/forms";
import { DATA_ITEMS, grievanceOfficer } from "@/modules/privacy/lib/notice";
import { guardianLink } from "@/modules/privacy/services/children";
import { confirmGuardianAction } from "../../actions";

export const metadata = { title: "Consent for a learner under 18", referrer: "no-referrer" as const, robots: { index: false } };

/**
 * The page a parent or guardian's link opens (DPDP Rule 10): what we process for the learner,
 * and a box to give consent. The link is the check: it went to the contact they control.
 */
export default async function GuardianConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await guardianLink(token);
  const g = grievanceOfficer();

  if (link.state === "invalid") {
    return (
      <PublicShell>
        <h1 className="text-[clamp(2rem,6vw,2.8rem)] leading-tight font-medium">This link doesn&apos;t work</h1>
        <p className="mt-3 text-[16px] text-muted">It may have been replaced by a newer one. Ask the learner to send a new link from their privacy settings.</p>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <p className="text-[14px] text-muted">For {link.guardianName}</p>
      <h1 className="mt-1 text-[clamp(2rem,6vw,2.8rem)] leading-[1.08] font-medium tracking-[-0.01em]">Your consent for {link.learnerName}</h1>
      <p className="mt-4 text-[16px] leading-relaxed text-muted">
        {link.learnerName} has signed up on Zinny and says they are under 18. India&apos;s data protection law needs a parent or guardian&apos;s consent before we process their data.
      </p>

      <div className="mt-6 rounded-[22px] border border-line bg-surface p-5">
        <h2 className="text-[1.35rem] font-medium">What we process, and why</h2>
        <ul className="mt-3 space-y-2.5 text-[14px]">
          {DATA_ITEMS.slice(0, 7).map((d) => (
            <li key={d.what}>
              <span className="font-medium">{d.what}.</span> <span className="text-muted">{d.why}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[14px] text-muted">
          We never track learners under 18 for advertising or show them targeted ads. Read the full{" "}
          <Link href="/privacy" className="text-brand underline underline-offset-2">
            privacy notice
          </Link>
          .
        </p>
      </div>

      <div className="mt-6">
        {link.state === "verified" ? (
          <Notice>Your consent is already recorded. Thank you.</Notice>
        ) : link.state === "expired" ? (
          <Notice tone="warn">This link has expired. Ask {link.learnerName} to send a new one from their privacy settings.</Notice>
        ) : (
          <GuardianConfirmForm action={confirmGuardianAction.bind(null, token)} learnerName={link.learnerName} />
        )}
      </div>

      <p className="mt-8 text-[14px] text-muted">
        Not {link.learnerName}&apos;s parent or guardian, or want to withdraw consent later? Write to {g.name} at{" "}
        <a href={`mailto:${g.email}`} className="text-brand underline underline-offset-2">
          {g.email}
        </a>
        .
      </p>
    </PublicShell>
  );
}
