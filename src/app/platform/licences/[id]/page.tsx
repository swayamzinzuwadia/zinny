import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { NoAccess, RenewalText, StatusBadge } from "@/modules/zinny-team-panel/components/bits";
import { LicencePanel } from "@/modules/zinny-team-panel/components/licence-panel";
import { formatDate, formatDateTime } from "@/modules/zinny-team-panel/lib/format";
import { licenceFor } from "@/modules/zinny-team-panel/services/licences";

export const metadata = { title: "Licence" };

/**
 * The licence on a page of its own, for people who look after licences but don't have the
 * Institutes section (Finance Admin). Everyone else edits it on the institute's Licence tab.
 */
export default async function LicencePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.licences")) return <NoAccess section="Licences" />;
  const { id } = await params;
  const data = await licenceFor(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { university: u, licence: l } = data;
  // People who look after institutes edit the licence on the institute's own page.
  if (canPlatform(actor, "platform.manage_universities")) redirect(`/platform/institutes/${u.id}?tab=licence`);

  return (
    <>
      <PageHeader
        title={`${u.name} licence`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={u.status} />
            {l ? (
              <span>
                Last changed {formatDateTime(l.updatedAt)}. Ends {formatDate(l.endDate)} (
                <RenewalText daysLeft={data.daysLeft} />)
              </span>
            ) : (
              <span>No licence yet. Usage and renewals are tracked once you save one.</span>
            )}
          </span>
        }
      />

      <LicencePanel actor={actor} data={data} />
    </>
  );
}
