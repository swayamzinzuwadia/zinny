import Link from "next/link";
import { Empty } from "@/components/ui";
import { can, todayIn } from "@/server/core";
import { spaceContext } from "@/server/context";
import { MyPrivacy } from "@/modules/privacy/components/my-privacy";
import { grievanceOfficer } from "@/modules/privacy/lib/notice";
import { myConsents } from "@/modules/privacy/services/consents";
import { myMinorState } from "@/modules/privacy/services/children";
import { myRequests } from "@/modules/privacy/services/requests";
import { instituteGrievance } from "@/modules/privacy/services/retention";
import { declareAgeAction, fileRequestAction, grantConsentAction, resendGuardianAction, withdrawConsentAction } from "@/app/privacy/actions";

export const metadata = { title: "Your privacy" };

/** A learner's (or any member's) privacy page inside their institute: the institute is the Data Fiduciary here. */
export default async function ProfilePrivacyPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "self.profile", { universityId: university.id, ownerUserId: actor.userId })) {
    return (
      <Empty title="You don't have a profile at this institute">
        Your role here has ended or hasn&apos;t started yet. <Link href="/privacy/my" className="text-brand hover:underline">See your Zinny privacy settings</Link>.
      </Empty>
    );
  }
  const [consents, requests, minor, own] = await Promise.all([myConsents(actor), myRequests(actor), myMinorState(actor), instituteGrievance(actor)]);
  const officer = grievanceOfficer();
  return (
    <MyPrivacy
      scope="institute"
      fiduciaryName={university.name}
      consents={consents}
      requests={requests.filter((r) => r.universityId === university.id)}
      minor={minor}
      today={todayIn(university.timezone)}
      exportHref={`/${uni}/profile/privacy/export`}
      profileHref={`/${uni}/profile`}
      grievance={{ name: own?.name ?? officer.name, email: own?.email ?? officer.email, days: officer.responseDays }}
      actions={{
        grant: grantConsentAction.bind(null, uni),
        withdraw: withdrawConsentAction.bind(null, uni),
        request: fileRequestAction.bind(null, uni),
        age: declareAgeAction.bind(null, uni),
        resend: resendGuardianAction.bind(null, uni),
      }}
    />
  );
}
