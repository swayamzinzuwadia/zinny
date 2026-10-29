import { Card } from "@/components/ui";
import { buttonClass } from "@/components/ui";
import { shortDate, type EffectiveStatus } from "../lib";
import type { CertificateView } from "../service";
import { CertificateArt } from "./certificate-art";
import { ShareLink } from "./share-link";
import { StatusBadge } from "./status-badge";

const STATUS_NOTE: Record<EffectiveStatus, string | null> = {
  valid: null,
  expired: "This certificate has expired. Its link shows it as expired. Ask your institute how to renew it.",
  revoked: "Your institute has revoked this certificate. Its link shows it as revoked.",
};

/** A learner's certificate: the certificate itself, its dates and status, download and share. Mobile first. */
export function CertificateCard({ uni, c, svg, showCourse = true }: { uni: string; c: CertificateView; svg: string | null; showCourse?: boolean }) {
  const note = STATUS_NOTE[c.status];
  return (
    <Card className="p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:gap-6">
        {svg && <CertificateArt svg={svg} label={`Certificate for ${c.courseTitle}`} />}
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {showCourse ? <h2 className="text-[17px] font-semibold leading-snug">{c.courseTitle}</h2> : <h2 className="text-[17px] font-semibold">Your certificate</h2>}
            <StatusBadge status={c.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
            <div>
              <dt className="text-[12px] text-muted">Issued</dt>
              <dd className="tabular">{shortDate(c.issuedOn)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Valid until</dt>
              <dd className="tabular">{c.validUntil ? shortDate(c.validUntil) : "No expiry"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[12px] text-muted">Certificate code</dt>
              <dd className="tabular font-mono text-[13px]">{c.displayCode}</dd>
            </div>
          </dl>
          {note && <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-[13px] text-muted">{note}</p>}
          <div className="mt-4 flex flex-wrap gap-2 md:mt-auto md:pt-4">
            <a href={`/${uni}/learn/certificates/${c.id}/download`} className={buttonClass("primary", "sm")}>
              Download PDF
            </a>
            <ShareLink path={c.verifyPath} title={`My certificate for ${c.courseTitle}`} />
          </div>
        </div>
      </div>
    </Card>
  );
}
