import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import type { HubSectionProps } from "@/contracts/module";
import { shortDate } from "../lib";
import { myCertificates } from "../service";
import { StatusBadge } from "./status-badge";

/** My learning → Certificates (learnerHubSections.certificates). Shows nothing until there is a certificate. */
export async function CertificatesHubSection({ uni, actor }: HubSectionProps) {
  const { rows } = await myCertificates(actor);
  const current = rows.filter((r) => !r.replacedById);
  if (current.length === 0) return null;
  const shown = current.slice(0, 3);
  return (
    <Card className="p-5">
      <CardTitle hint={current.length > 3 ? `${current.length} in all` : undefined}>Certificates</CardTitle>
      <ul className="divide-y divide-line">
        {shown.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="truncate font-medium">{c.courseTitle}</div>
              <div className="text-[13px] text-muted">Issued {shortDate(c.issuedOn)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <StatusBadge status={c.status} />
              <a href={`/${uni}/learn/certificates/${c.id}/download`} className="text-[13px] font-medium text-brand hover:underline">
                Download
              </a>
            </div>
          </li>
        ))}
      </ul>
      <Link href={`/${uni}/learn/certificates`} className="mt-4 inline-block text-[14px] font-medium text-brand hover:underline">
        See all certificates
      </Link>
    </Card>
  );
}
