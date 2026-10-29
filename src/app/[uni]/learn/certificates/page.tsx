import Link from "next/link";
import { Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { ForbiddenError } from "@/server/errors";
import { CertificateCard } from "@/modules/certificates/components/certificate-card";
import { StatusBadge } from "@/modules/certificates/components/status-badge";
import { shortDate } from "@/modules/certificates/lib";
import { certificateSvg, myCertificates } from "@/modules/certificates/service";

export const metadata = { title: "Certificates" };

/** The learner's certificates: download, or share a link anyone can use to check them. Alumni keep them. */
export default async function LearnerCertificates({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const mine = await myCertificates(actor).catch((e) => {
    if (e instanceof ForbiddenError) return null;
    throw e;
  });

  return (
    <>
      <Link href={`/${uni}/learn/my`} className="text-sm text-muted">
        My learning
      </Link>
      <h1 className="mb-1 mt-2 text-[26px] font-semibold tracking-tight">Certificates</h1>
      <p className="mb-6 text-[14px] text-muted">Download your certificates, or share a link anyone can use to check they&apos;re genuine.</p>
      {!mine ? (
        <Empty title="Certificates are for students and alumni">Sign in with your student account to see yours.</Empty>
      ) : (
        <CertificateList uni={uni} rows={mine.rows} svgs={await Promise.all(mine.rows.filter((r) => !r.replacedById).map((r) => certificateSvg(actor, r.id)))} />
      )}
    </>
  );
}

function CertificateList({ uni, rows, svgs }: { uni: string; rows: Awaited<ReturnType<typeof myCertificates>>["rows"]; svgs: string[] }) {
  const current = rows.filter((r) => !r.replacedById);
  const earlier = rows.filter((r) => r.replacedById);
  if (current.length === 0) {
    return <Empty title="No certificates yet">When you complete a course that awards one, it appears here.</Empty>;
  }
  return (
    <div className="space-y-4">
      {current.map((c, i) => (
        <CertificateCard key={c.id} uni={uni} c={c} svg={svgs[i]} />
      ))}
      {earlier.length > 0 && (
        <section className="rounded-[22px] border border-line bg-surface p-4 text-[14px]">
          <h2 className="mb-1 font-medium">Earlier certificates</h2>
          <p className="mb-2 text-[13px] text-muted">Replaced by a renewal or a corrected certificate.</p>
          <ul className="divide-y divide-line">
            {earlier.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{r.courseTitle}</span>
                  <span className="font-mono text-[12px] text-muted">
                    {r.displayCode}, issued {shortDate(r.issuedOn)}
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
