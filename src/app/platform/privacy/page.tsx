import { ButtonLink, PageHeader, Stat, Tabs } from "@/components/ui";
import { todayIn } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { RequestQueue } from "@/modules/privacy/components/request-queue";
import { canPlatformPrivacy } from "@/modules/privacy/services/access";
import { platformRequests } from "@/modules/privacy/services/requests";
import { decidePlatformRequestAction } from "./actions";

export const metadata = { title: "Privacy requests" };

/**
 * Every personal data request on Zinny. The team answers Zinny's own (marketplace learners and
 * institute sign-ups); each institute answers its learners' requests, and the team watches
 * that none slips past its due date.
 */
export default async function PlatformPrivacyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await platformContext();
  if (!canPlatformPrivacy(actor)) return <NoAccess section="Privacy" who="Super Admins and Account Managers" />;
  const tab = (await searchParams).tab === "institutes" ? "institutes" : "zinny";
  const rows = await platformRequests(actor);
  const today = todayIn("Asia/Kolkata");
  const ours = rows.filter((r) => r.universityId === null);
  const theirs = rows.filter((r) => r.universityId !== null);
  const isOpen = (r: (typeof rows)[number]) => r.status === "open" || r.status === "in_progress";
  const lateTheirs = theirs.filter((r) => isOpen(r) && r.dueOn < today).length;

  return (
    <>
      <PageHeader
        title="Privacy requests"
        subtitle="Zinny answers requests from marketplace learners and the people who sign institutes up. Institutes answer their own learners; you can see if any are late."
        actions={
          <ButtonLink href="/platform/privacy/breaches" variant="secondary" icon="forward">
            Open breach register
          </ButtonLink>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Zinny's open requests" value={ours.filter(isOpen).length} />
        <Stat label="Institutes' open requests" value={theirs.filter(isOpen).length} hint={lateTheirs ? <span className="text-danger">{lateTheirs} past due</span> : "None past due"} />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "zinny", label: "Zinny's requests", href: "/platform/privacy", count: ours.filter(isOpen).length },
          { key: "institutes", label: "Institutes' requests", href: "/platform/privacy?tab=institutes", count: theirs.filter(isOpen).length },
        ]}
      />
      <div className="mt-5">
        <RequestQueue rows={tab === "zinny" ? ours : theirs} today={today} decide={decidePlatformRequestAction} canDecide={(r) => r.universityId === null} showInstitute />
      </div>
    </>
  );
}
