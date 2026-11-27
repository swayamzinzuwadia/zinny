import { redirect } from "next/navigation";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { formatDate, todayIn } from "@/server/lib/dates";
import { DocumentsManager, type DocumentOnFile } from "@/modules/onboarding/components/documents-manager";
import { trialLine } from "@/modules/onboarding/components/trial-banner";
import { hasUsablePan, listDocuments } from "@/modules/onboarding/services/documents";
import { trialInfo } from "@/modules/onboarding/services/trial";
import { removeDocumentAction } from "../actions";

export const metadata = { title: "Your documents" };

/**
 * The institute's documents for the Zinny team: PAN card required, the rest optional. The
 * sign-up wizard lands here (?welcome=1). Under choose-plan, so it stays open while frozen.
 */
export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { uni } = await params;
  const { welcome } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "settings.manage", { universityId: university.id })) redirect(`/${uni}/admin`);
  const [docs, trial] = await Promise.all([listDocuments(actor), trialInfo(actor)]);
  const today = todayIn(university.timezone);
  const documents: DocumentOnFile[] = docs.map((d) => {
    const day = todayIn(university.timezone, d.createdAt);
    return {
      id: d.id,
      kind: d.kind,
      fileName: d.fileName,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      status: d.status,
      reviewerNote: d.reviewerNote,
      uploadedOn: day === today ? "today" : `on ${formatDate(day, { year: false })}`,
    };
  });
  const frozen = trial.status === "frozen";

  return (
    <>
      <PageHeader
        title={welcome ? `Welcome to Zinny, ${actor.name.split(" ")[0]}` : "Your documents"}
        subtitle="The Zinny team checks these in the background while you use Zinny. Your PAN card is required; the others help if your institute has them."
        actions={
          <ButtonLink href={frozen ? `/${uni}/admin/choose-plan` : `/${uni}/admin`} icon="forward">
            {frozen ? "Choose a plan" : "Go to your admin"}
          </ButtonLink>
        }
      />
      {welcome && trial.inTrial && trial.daysLeft !== null && trial.trialEndsAt && (
        <div className="mb-6">
          <Notice>Your free trial has started. {trialLine(trial.daysLeft, trial.trialEndsAt)}</Notice>
        </div>
      )}
      {!hasUsablePan(docs) && (
        <div className="mb-6">
          <Notice tone="gold">Upload your institute&apos;s PAN card. You&apos;ll need it before you choose a plan.</Notice>
        </div>
      )}
      <DocumentsManager uni={uni} documents={documents} remove={removeDocumentAction.bind(null, uni)} />
    </>
  );
}
