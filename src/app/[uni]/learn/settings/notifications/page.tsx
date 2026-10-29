import { notFound } from "next/navigation";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { PreferencesForm } from "@/modules/notifications-delivery/components/preferences-form";
import { getPreferences } from "@/modules/notifications-delivery/service";

export const metadata = { title: "Notification settings" };

/** A learner's own notification settings (self.profile). Always the signed-in person's. */
export default async function LearnerNotificationSettings({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "self.profile", { universityId: university.id, ownerUserId: actor.userId })) notFound();
  const prefs = await getPreferences(actor, actor.userId);
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">Notifications</h1>
      <p className="mb-5 mt-1 text-[14px] text-muted">Choose how {university.name} reaches you. You&apos;ll always see notifications in the app.</p>
      <PreferencesForm uni={uni} rows={prefs.rows} email={prefs.email} phone={prefs.phone} profileHref={`/${uni}/profile`} />
    </>
  );
}
