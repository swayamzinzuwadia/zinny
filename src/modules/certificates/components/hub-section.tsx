import { Card, CardTitle, ActionAnchor, ActionLink } from "@/components/ui";
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
              {c.status !== "revoked" && (
                <ActionAnchor href={`/${uni}/learn/certificates/${c.id}/download`}>
                  Download
                </ActionAnchor>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ActionLink href={`/${uni}/learn/certificates`} className="mt-3" icon="view">
        See all certificates
      </ActionLink>
    </Card>
  );
}
