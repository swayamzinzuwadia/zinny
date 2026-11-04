import { notFound } from "next/navigation";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { PreferencesForm } from "@/modules/notifications-delivery/components/preferences-form";
import { forLearnerSettings, learnerDescription } from "@/modules/notifications-delivery/kinds";
import { getPreferences } from "@/modules/notifications-delivery/service";
import { hasInvoices } from "@/modules/payments/invoices";
import { sendParentsHome } from "../../view";

export const metadata = { title: "Notification settings" };

/** A learner's own notification settings (self.profile). Always the signed-in person's. */
export default async function LearnerNotificationSettings({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  if (!can(actor, "self.profile", { universityId: university.id, ownerUserId: actor.userId })) notFound();
  const [prefs, paid] = await Promise.all([getPreferences(actor, actor.userId), hasInvoices(actor)]);
  // Learner kinds only, in the learner's own words; payment ones only for someone who has paid here.
  const rows = prefs.rows.filter((r) => forLearnerSettings(r.kind, paid)).map((r) => ({ ...r, description: learnerDescription(r.kind) }));
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Notifications</h1>
      <p className="mb-5 mt-1 text-[14px] text-muted">Choose how {university.name} reaches you. You&apos;ll always see notifications in the app.</p>
      <PreferencesForm uni={uni} rows={rows} email={prefs.email} phone={prefs.phone} profileHref={`/${uni}/profile`} />
    </>
  );
}
