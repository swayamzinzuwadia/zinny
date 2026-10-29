import { ActionForm } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { saveMyProfileAction } from "@/modules/website-builder/actions";
import { ProfileTabs, Thumb } from "@/modules/website-builder/components/admin";
import { ImageField } from "@/modules/website-builder/components/image-field";
import { IntentButton } from "@/modules/website-builder/components/intent-button";
import { getMyProfile, PROFILE_STATUS_LABEL } from "@/modules/website-builder/faculty";
import { formatMoment } from "@/modules/website-builder/format";
import { mediaPath } from "@/modules/website-builder/media";

export const metadata = { title: "My profile page" };

const TONE = { pending: "gold", approved: "brand", changes_requested: "warn", draft: "neutral" } as const;

export default async function MyProfilePage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const mine = await getMyProfile(actor);

  if (!mine.eligible) {
    return (
      <>
        <PageHeader title="My profile page" />
        <ProfileTabs uni={uni} actor={actor} active="me" />
        <Empty title="Public profiles are for teaching staff">If you teach here, ask an Institute Admin to add you as faculty.</Empty>
      </>
    );
  }

  const { profile, courses } = mine;
  const draft = profile?.draft ?? { headline: "", bio: "", subjects: [], photoMediaId: null };
  const live = profile?.published && profile.visible ? profile : null;

  return (
    <>
      <PageHeader
        title="My profile page"
        subtitle="Your public page on the university website: a photo, a headline, a short bio and what you teach. An admin checks it before it goes live."
      />
      <ProfileTabs uni={uni} actor={actor} active="me" />

      <div className="mb-6 space-y-3">
        {profile && (
          <div className="flex flex-wrap items-center gap-3 text-[14px]">
            <Badge tone={TONE[profile.status]}>{PROFILE_STATUS_LABEL[profile.status]}</Badge>
            {profile.status === "pending" && profile.submittedAt && (
              <span className="text-muted">Sent {formatMoment(profile.submittedAt, university.timezone)}. You&apos;ll get a notification when it&apos;s reviewed.</span>
            )}
            {profile.status === "approved" && <span className="text-muted">Your profile is live.</span>}
            {profile.status === "draft" && profile.published && <span className="text-muted">Your live profile stays as it is until you send these changes and they are approved.</span>}
            {live && (
              <a href={`/site/${uni}/faculty/${profile.id}`} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
                View it on the website
              </a>
            )}
          </div>
        )}
        {profile?.published && !profile.visible && <Notice tone="neutral">An admin has hidden your profile from the website for now.</Notice>}
        {profile?.status === "changes_requested" && profile.reviewNote && (
          <Notice tone="warn">
            <b className="font-medium">Changes requested:</b> {profile.reviewNote}
          </Notice>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <ActionForm action={saveMyProfileAction} resetOnSuccess={false} className="space-y-5">
            <input type="hidden" name="uni" value={uni} />
            <ImageField
              key={draft.photoMediaId ?? "none"}
              uni={uni}
              kind="faculty"
              name="photoMediaId"
              label="Photo"
              shape="square"
              hint="A clear, recent photo of your face, facing the camera."
              initial={draft.photoMediaId ? { id: draft.photoMediaId, src: mediaPath(uni, draft.photoMediaId) } : null}
            />
            <Field label="Headline" hint="Your role and speciality, like “Associate Professor, Data Science”.">
              <Input name="headline" defaultValue={draft.headline} maxLength={120} />
            </Field>
            <Field label="Bio" hint="A few sentences in the third person: your background, what you teach and what students can expect. At least 40 characters.">
              <Textarea name="bio" defaultValue={draft.bio} rows={7} maxLength={2000} className="text-[14px]" />
            </Field>
            <Field label="Subjects" hint="Separate them with commas, like SQL, Power BI, Statistics.">
              <Input name="subjects" defaultValue={draft.subjects.join(", ")} />
            </Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-medium">Courses</span>
              <p className="text-[14px] text-muted">
                {courses.length ? courses.map((c) => c.title).join(", ") : "None right now."} These come from the batches you teach.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <IntentButton intent="draft" variant="secondary" pendingText="Saving…">
                Save draft
              </IntentButton>
              <IntentButton intent="submit" pendingText="Sending…">
                Send for approval
              </IntentButton>
            </div>
          </ActionForm>
        </Card>

        <Card className="h-fit bg-canvas">
          <CardTitle>How it will look</CardTitle>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center gap-4">
              <Thumb src={draft.photoMediaId ? mediaPath(uni, draft.photoMediaId) : null} name={actor.name} size={64} round />
              <div className="min-w-0">
                <div className="font-medium">{actor.name}</div>
                <div className="text-[13px] text-muted">{draft.headline || "Your headline"}</div>
              </div>
            </div>
            <p className="mt-4 line-clamp-5 whitespace-pre-line text-[14px] text-ink/85">{draft.bio || "Your bio appears here."}</p>
            {draft.subjects.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {draft.subjects.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            )}
          </div>
          <p className="mt-3 text-[12px] text-muted">The preview shows your last saved draft.</p>
        </Card>
      </div>
    </>
  );
}
