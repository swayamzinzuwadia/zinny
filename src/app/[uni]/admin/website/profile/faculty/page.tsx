import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, PageHeader, Tabs, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { approveProfileAction, profileVisibilityAction, sendBackProfileAction } from "@/modules/website-builder/actions";
import { ActionButton } from "@/modules/website-builder/components/action-button";
import { NoAccess, ProfileTabs, Thumb } from "@/modules/website-builder/components/admin";
import { listFacultyProfiles, PROFILE_STATUS_LABEL, type ProfileListFilter } from "@/modules/website-builder/faculty";
import { formatMoment } from "@/modules/website-builder/format";
import { mediaPath } from "@/modules/website-builder/media";

export const metadata = { title: "Faculty profiles" };

const FILTERS: { key: ProfileListFilter; label: string }[] = [
  { key: "pending", label: "Waiting for approval" },
  { key: "approved", label: "Approved" },
  { key: "changes_requested", label: "Sent back" },
  { key: "draft", label: "Not sent yet" },
  { key: "all", label: "All" },
];

const TONE = { pending: "gold", approved: "brand", changes_requested: "warn", draft: "neutral" } as const;

export default async function FacultyProfilesPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ show?: string }> }) {
  const { uni } = await params;
  const { show } = await searchParams;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Faculty profiles" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const filter = (FILTERS.some((f) => f.key === show) ? show : "pending") as ProfileListFilter;
  const { rows, counts, withoutProfile } = await listFacultyProfiles(actor, filter);
  const base = `/${uni}/admin/website/profile/faculty`;

  return (
    <>
      <PageHeader
        title="Faculty profiles"
        subtitle="Teaching staff write their own public profile. Check each one before it goes on the website."
      />
      <ProfileTabs uni={uni} actor={actor} active="faculty" pendingProfiles={counts.pending} />
      <Tabs
        active={filter}
        tabs={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          href: `${base}?show=${f.key}`,
          count: f.key === "all" ? undefined : (counts[f.key as keyof typeof counts] ?? 0),
        }))}
      />

      {rows.length === 0 ? (
        <Empty title={filter === "pending" ? "Nothing waiting for approval" : "No profiles here"}>
          {filter === "pending" ? "When a faculty member sends their profile, it shows up here." : "Try another tab."}
        </Empty>
      ) : (
        <div className="space-y-4">
          {rows.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-start gap-5">
                <Thumb src={p.draft.photoMediaId ? mediaPath(uni, p.draft.photoMediaId) : null} name={p.name} size={72} round />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[17px] font-medium">{p.name}</h2>
                    <Badge tone={TONE[p.status]}>{PROFILE_STATUS_LABEL[p.status]}</Badge>
                    {p.published && !p.visible && <Badge tone="neutral">Hidden from website</Badge>}
                  </div>
                  <div className="text-[13px] text-muted">
                    {p.email}
                    {p.submittedAt && <>. Sent {formatMoment(p.submittedAt, university.timezone)}</>}
                  </div>
                  {p.draft.headline && <p className="mt-3 font-medium">{p.draft.headline}</p>}
                  {p.draft.bio && <p className="mt-1 max-w-3xl whitespace-pre-line text-[14px] text-ink/85">{p.draft.bio}</p>}
                  {p.draft.subjects.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.draft.subjects.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-[13px] text-muted">
                    {p.courses.length ? <>Teaches {p.courses.map((c) => c.title).join(", ")}.</> : "Not teaching a published course right now."}
                  </p>
                  {p.status === "pending" && p.published && p.hasChanges && (
                    <p className="mt-2 text-[13px] text-gold-strong">These are changes to a live profile. The current version stays on the website until you approve.</p>
                  )}
                  {p.status === "changes_requested" && p.reviewNote && (
                    <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">Your note: {p.reviewNote}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {p.status === "pending" && (
                    <ActionButton action={approveProfileAction} fields={{ uni, id: p.id }} variant="primary" size="md">
                      Approve and publish
                    </ActionButton>
                  )}
                  {p.published && (
                    <>
                      <ActionButton action={profileVisibilityAction} fields={{ uni, id: p.id, visible: String(!p.visible) }}>
                        {p.visible ? "Hide from website" : "Show on website"}
                      </ActionButton>
                      {p.visible && (
                        <a href={`/site/${uni}/faculty/${p.id}`} target="_blank" rel="noreferrer" className="text-[13px] text-brand underline underline-offset-2">
                          View on website
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>
              {p.status === "pending" && (
                <details className="mt-4 border-t border-line pt-3">
                  <summary className="cursor-pointer text-[13px] text-brand">Send back with a note</summary>
                  <ActionForm action={sendBackProfileAction} className="mt-3 max-w-xl space-y-3">
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="id" value={p.id} />
                    <Textarea name="note" rows={3} required minLength={5} maxLength={600} placeholder="Say what to change, like “Please add a photo and the subjects you teach.”" aria-label="Note for the faculty member" />
                    <SubmitButton variant="secondary" size="sm" pendingText="Sending…">
                      Send back
                    </SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}

      {withoutProfile.length > 0 && (
        <p className="mt-8 text-[14px] text-muted">
          No profile yet: {withoutProfile.map((p) => p.name).join(", ")}. They can write one from the “Your public profile” card on their dashboard.
        </p>
      )}
    </>
  );
}
