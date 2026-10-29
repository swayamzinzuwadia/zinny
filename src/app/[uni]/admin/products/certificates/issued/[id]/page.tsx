import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Notice, PageHeader, Textarea, buttonClass } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { revokeCertificateAction } from "@/modules/certificates/actions";
import { CertificateArt } from "@/modules/certificates/components/certificate-art";
import { StatusBadge } from "@/modules/certificates/components/status-badge";
import { shortDate } from "@/modules/certificates/lib";
import { certificateDetail, certificateSvg } from "@/modules/certificates/service";

export const metadata = { title: "Certificate" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** One issued certificate, for staff with cert.view on its department or batch. */
export default async function IssuedCertificatePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const base = `/${uni}/admin/products/certificates`;
  const d = await certificateDetail(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const c = d.certificate;
  const svg = await certificateSvg(actor, id);
  const courseTab = `/${uni}/admin/products/courses/${c.courseId}?tab=certificates`;

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        Products /{" "}
        <Link href={`${base}#issued`} className="hover:text-ink">
          Certificates
        </Link>{" "}
        / <span className="font-mono">{c.displayCode}</span>
      </div>
      <PageHeader
        title={c.studentName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            <Link href={courseTab} className="hover:text-ink">
              {c.courseTitle}
            </Link>
          </span>
        }
        actions={
          <>
            <a href={`${base}/issued/${id}/download`} className={buttonClass("primary")}>
              Download PDF
            </a>
            <a href={c.verifyPath} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              Open verify page
            </a>
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <CertificateArt svg={svg} label={`Certificate ${c.displayCode}`} />

        <div className="space-y-6">
          {c.status === "revoked" && (
            <Notice tone="danger">
              Revoked{d.revokedAt ? ` on ${shortDate(d.revokedAt.toISOString().slice(0, 10))}` : ""} by {d.revokedByName}. Reason: {c.revokeReason}
            </Notice>
          )}
          {c.replacedById && (
            <Notice tone="neutral">
              A newer certificate follows this one.{" "}
              <Link href={`${base}/issued/${c.replacedById}`} className="font-medium underline underline-offset-2">
                Open it
              </Link>
            </Notice>
          )}

          <Card>
            <CardTitle>Details</CardTitle>
            <dl className="divide-y divide-line text-[14px]">
              <Row label="Code">
                <span className="tabular font-mono">{c.displayCode}</span>
              </Row>
              <Row label="Batch">{c.batchName}</Row>
              <Row label="Completed">{shortDate(c.completedOn)}</Row>
              <Row label="Issued">{shortDate(c.issuedOn)}</Row>
              <Row label="Valid until">{c.validUntil ? shortDate(c.validUntil) : "No expiry"}</Row>
              <Row label="How">
                {c.source === "automatic" ? (
                  "Automatically, when the course was completed"
                ) : (
                  <>
                    By hand, by {d.issuedByName}
                    <span className="block text-muted">{c.issueReason}</span>
                  </>
                )}
              </Row>
              <Row label="PDF">
                <span className="text-muted">
                  {Math.max(1, Math.round(d.pdfBytes / 1024))} KB, fingerprint{" "}
                  <span className="font-mono text-[12px]" title={`SHA-256 ${d.pdfSha256}`}>
                    {d.pdfSha256.slice(0, 12)}
                  </span>
                </span>
              </Row>
            </dl>
          </Card>

          {d.chain.length > 1 && (
            <Card>
              <CardTitle>History for this enrolment</CardTitle>
              <ol className="space-y-2 text-[14px]">
                {d.chain.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                    {x.id === c.id ? (
                      <span className="font-mono font-medium">{x.displayCode}</span>
                    ) : (
                      <Link href={`${base}/issued/${x.id}`} className="font-mono text-brand hover:underline">
                        {x.displayCode}
                      </Link>
                    )}
                    <span className="text-muted">{shortDate(x.issuedOn)}</span>
                    <StatusBadge status={x.status} />
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {d.canIssue && c.status !== "revoked" && (
            <Card>
              <CardTitle>Revoke this certificate</CardTitle>
              <ActionForm action={revokeCertificateAction} className="space-y-3" confirm="Revoke this certificate? Its verify page will show it as revoked. This can't be undone.">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="certificateId" value={id} />
                <Field label="Reason" hint="Kept on record. The student is told the certificate was revoked, not why.">
                  <Textarea name="reason" required minLength={5} maxLength={500} placeholder="Issued before the final project was graded" />
                </Field>
                <SubmitButton variant="danger" pendingText="Revoking…">
                  Revoke certificate
                </SubmitButton>
              </ActionForm>
            </Card>
          )}
          {d.canIssue && (c.status === "revoked" || c.status === "expired") && !c.replacedById && (
            <p className="px-1 text-[13px] text-muted">
              To give {c.studentName} a new certificate, use Issue by hand on the{" "}
              <Link href={courseTab} className="text-brand underline underline-offset-2">
                course&apos;s Certificates tab
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </>
  );
}
