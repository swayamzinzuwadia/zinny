import Link from "next/link";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { shortDate, type EffectiveStatus } from "@/modules/certificates/lib";
import { verifyForVisitor } from "@/modules/certificates/service";

export const dynamic = "force-dynamic";

const STATUS: Record<EffectiveStatus, { title: string; note: string; tone: string; icon: ReactNode }> = {
  valid: {
    title: "This certificate is valid",
    note: "It was issued by the institute below and has not been revoked.",
    tone: "bg-brand-soft text-brand-strong",
    icon: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  },
  expired: {
    title: "This certificate has expired",
    note: "It was genuinely issued by the institute below, but its validity period has ended.",
    tone: "bg-warn-soft text-warn",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },
  revoked: {
    title: "This certificate has been revoked",
    note: "The institute below has withdrawn it. It should not be relied on.",
    tone: "bg-danger-soft text-danger",
    icon: <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-medium">{children}</dd>
    </div>
  );
}

/** The public result for one code: the student, course, institute, issue date and status. Nothing else. */
export default async function VerifyCode({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let typed = code;
  try {
    typed = decodeURIComponent(code);
  } catch {
    // Already decoded, or not valid percent-encoding: use it as it is.
  }
  const outcome = await verifyForVisitor(typed, await headers());

  if (outcome.kind === "limited") {
    const minutes = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
    return (
      <div role="alert" className="rounded-[22px] border border-line bg-surface p-6">
        <h1 className="text-[22px] font-semibold">Too many checks from your network</h1>
        <p className="mt-2 text-[15px] text-muted">
          To protect students&apos; records, checks are limited. Try again in {minutes === 1 ? "a minute" : `${minutes} minutes`}.
        </p>
      </div>
    );
  }

  if (outcome.kind === "not_found") {
    return (
      <div className="rounded-[22px] border border-line bg-surface p-6">
        <h1 className="text-[22px] font-semibold">No certificate has this code</h1>
        <p className="mt-2 text-[15px] text-muted">
          Check the code against the certificate and try again. Codes have 12 letters and numbers, like 7K3P-9QXA-M2D4. If it still isn&apos;t found, the certificate
          may not be genuine: contact the institute that issued it.
        </p>
        <Link href="/verify" className="mt-5 inline-block text-[14px] font-medium text-brand hover:underline">
          Check another code
        </Link>
      </div>
    );
  }

  const c = outcome.certificate;
  const s = STATUS[c.status];
  return (
    <article aria-labelledby="result" className="overflow-hidden rounded-[22px] border border-line bg-surface">
      <div className={cx("flex items-start gap-3 px-6 py-5", s.tone)}>
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden className="mt-0.5 shrink-0">
          {s.icon}
        </svg>
        <div>
          <h1 id="result" className="text-[20px] font-semibold leading-snug">
            {s.title}
          </h1>
          <p className="mt-0.5 text-[14px] opacity-90">{s.note}</p>
        </div>
      </div>
      <dl className="divide-y divide-line px-6">
        <Row label="Awarded to">{c.studentName}</Row>
        <Row label="Course">{c.courseTitle}</Row>
        <Row label="Institute">{c.institute}</Row>
        <Row label="Issued on">{shortDate(c.issuedOn)}</Row>
        <Row label="Certificate code">
          <span className="tabular font-mono text-[15px]">{c.code}</span>
        </Row>
      </dl>
      <div className="border-t border-line px-6 py-4">
        <Link href="/verify" className="text-[14px] font-medium text-brand hover:underline">
          Check another code
        </Link>
      </div>
    </article>
  );
}
