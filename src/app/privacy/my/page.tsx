import { redirect } from "next/navigation";
import { ActionLink, Card, CardTitle } from "@/components/ui";
import { currentUserId, spacesFor } from "@/server/auth/session";
import { loadActor, todayIn } from "@/server/core";
import { MyPrivacy } from "@/modules/privacy/components/my-privacy";
import { PublicShell } from "@/modules/privacy/components/public-shell";
import { grievanceOfficer } from "@/modules/privacy/lib/notice";
import { myConsents } from "@/modules/privacy/services/consents";
import { myMinorState } from "@/modules/privacy/services/children";
import { myRequests } from "@/modules/privacy/services/requests";
import { declareAgeAction, fileRequestAction, grantConsentAction, resendGuardianAction, withdrawConsentAction } from "../actions";

export const metadata = { title: "Your privacy" };

/**
 * Privacy settings for Zinny's own records: the whole page for a marketplace learner (who
 * belongs to no institute), and for everyone else the account they share across institutes,
 * with a way into each institute's own privacy page.
 */
export default async function MyZinnyPrivacyPage() {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/privacy/my");
  const actor = await loadActor(userId, null);
  const [consents, requests, minor, spaces] = await Promise.all([myConsents(actor), myRequests(actor), myMinorState(actor), spacesFor(userId)]);
  const institutes = spaces.filter((s) => s.roles.some((r) => r !== "individual_learner"));
  const officer = grievanceOfficer();
  return (
    <PublicShell>
      <MyPrivacy
        scope="zinny"
        fiduciaryName="Zinny"
        consents={consents}
        requests={requests.filter((r) => r.universityId === null)}
        minor={minor}
        today={todayIn("Asia/Kolkata")}
        exportHref="/privacy/my/export"
        profileHref={null}
        grievance={{ name: officer.name, email: officer.email, days: officer.responseDays }}
        actions={{
          grant: grantConsentAction.bind(null, ""),
          withdraw: withdrawConsentAction.bind(null, ""),
          request: fileRequestAction.bind(null, ""),
          age: declareAgeAction.bind(null, ""),
          resend: resendGuardianAction.bind(null, ""),
        }}
      />
      {institutes.length > 0 && (
        <Card className="mt-5 p-5 sm:p-6">
          <CardTitle>Your institutes</CardTitle>
          <p className="mb-3 text-[14px] text-muted">Each institute you study or work at holds its own records about you. See and change them there.</p>
          <ul className="divide-y divide-line">
            {institutes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate font-medium">{s.name}</span>
                <ActionLink href={`/${s.slug}/profile/privacy`} icon="forward">
                  Open privacy
                </ActionLink>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PublicShell>
  );
}
