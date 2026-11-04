import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canAdmit, getJoinSettings } from "@/modules/identity/joining";
import { joinLink, joinQrSvg } from "@/modules/identity/share";
import { PrintButton } from "@/modules/identity/components/share-join-code";
import { display } from "@/modules/marketing/fonts";

export const metadata = { title: "Joining poster" };

/**
 * A printable A4 poster for the institute's notice board or classroom: scan the QR code (or type
 * the link) to sign up with the joining code. For the people who accept new students.
 */
export default async function JoinPoster({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!canAdmit(actor)) notFound();
  const { code, mode } = await getJoinSettings(actor);
  const link = joinLink(code);
  const qr = await joinQrSvg(link);

  return (
    <main className={`display-headings min-h-dvh bg-canvas px-4 py-8 print:bg-white print:p-0 ${display.variable}`}>
      <style>{`@page { size: A4; margin: 14mm; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print mx-auto mb-6 flex max-w-[720px] flex-wrap items-center justify-between gap-3">
        <Link href={`/${uni}/admin`} className="text-[14px] font-medium text-brand hover:underline">
          Back to the dashboard
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto flex max-w-[720px] flex-col items-center rounded-[28px] border border-line bg-white px-10 py-12 text-center print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0">
        <p className="text-[15px] font-medium tracking-wide text-gold-strong">Students</p>
        <h1 className="mt-2 text-[44px] leading-[1.1] font-semibold">Join {university.name}</h1>
        <p className="mt-3 max-w-[480px] text-[17px] text-muted">Scan the code with your phone camera to create your student account on Zinny.</p>

        <div className="mt-8 w-[260px] max-w-full" role="img" aria-label={`QR code for ${link}`} dangerouslySetInnerHTML={{ __html: qr }} />

        <div className="mt-8 text-[14px] text-muted">Or open this link</div>
        <div className="mt-1 text-[18px] font-medium break-all text-ink">{link}</div>

        <div className="mt-6 text-[14px] text-muted">Already have a Zinny account? Choose Join an institute and enter</div>
        <div className="tabular mt-1 rounded-2xl bg-brand-soft px-6 py-2 text-[40px] font-semibold tracking-[0.25em] text-brand-strong">{code}</div>

        <ol className="mt-10 grid w-full gap-4 text-left text-[15px] sm:grid-cols-3">
          {[
            "Scan the code or open the link.",
            "Create your account and pick your department.",
            mode === "approval" ? "The institute accepts you, and your courses appear." : "You're in straight away: your courses appear.",
          ].map((step, i) => (
            <li key={step} className="flex gap-3 rounded-2xl border border-line p-4">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[14px] font-semibold text-canvas">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <Logo height={26} />
        </div>
      </article>
    </main>
  );
}
