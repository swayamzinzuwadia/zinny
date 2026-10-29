import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, PageHeader, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { saveTeamMemberAction } from "@/modules/website-builder/actions";
import { NoAccess, SectionTabs, Thumb, VisibilityBadge } from "@/modules/website-builder/components/admin";
import { ImageField } from "@/modules/website-builder/components/image-field";
import { ItemControls } from "@/modules/website-builder/components/item-controls";
import { listTeam } from "@/modules/website-builder/content";
import { mediaPath } from "@/modules/website-builder/media";
import { attentionCounts } from "@/modules/website-builder/overview";

export const metadata = { title: "Team" };

type Row = Awaited<ReturnType<typeof listTeam>>[number];

function TeamFields({ uni, row }: { uni: string; row?: Row }) {
  return (
    <>
      <input type="hidden" name="uni" value={uni} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" defaultValue={row?.name} required maxLength={80} placeholder="Dr. Kavita Rao" />
        </Field>
        <Field label="Role">
          <Input name="title" defaultValue={row?.title} required maxLength={100} placeholder="Registrar" />
        </Field>
      </div>
      <Field label="Short bio" hint="Optional. Two or three sentences.">
        <Textarea name="bio" defaultValue={row?.bio} maxLength={600} rows={3} className="text-[14px]" />
      </Field>
      <Field label="LinkedIn" hint="Optional.">
        <Input name="linkedinUrl" defaultValue={row?.linkedinUrl} placeholder="https://linkedin.com/in/…" />
      </Field>
      <ImageField
        key={row?.photoMediaId ?? "none"}
        uni={uni}
        kind="team"
        name="photoMediaId"
        label="Photo"
        shape="square"
        initial={row?.photoMediaId ? { id: row.photoMediaId, src: mediaPath(uni, row.photoMediaId) } : null}
      />
    </>
  );
}

export default async function TeamPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Team" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [rows, counts] = await Promise.all([listTeam(actor), attentionCounts(actor)]);

  return (
    <>
      <PageHeader title="Team" subtitle="Leadership and administration: the people visitors might want to know or contact, in this order." />
      <SectionTabs uni={uni} active="team" counts={counts} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {rows.length === 0 ? (
            <Empty title="No team members yet">Add your leadership team on the right. Faculty have their own profiles.</Empty>
          ) : (
            <ul className="space-y-3">
              {rows.map((m, i) => (
                <li key={m.id} className={cx("rounded-[22px] border bg-surface", m.visible ? "border-line" : "border-dashed border-line bg-canvas/50")}>
                  <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                    <Thumb src={m.photoMediaId ? mediaPath(uni, m.photoMediaId) : null} name={m.name} size={48} round />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <span className="font-medium">{m.name}</span>
                        <VisibilityBadge visible={m.visible} />
                      </div>
                      <div className="text-[13px] text-muted">{m.title}</div>
                      {m.bio && <p className="mt-2 line-clamp-2 max-w-2xl text-[14px] text-ink/85">{m.bio}</p>}
                    </div>
                    <ItemControls uni={uni} collection="team" id={m.id} visible={m.visible} name={m.name} first={i === 0} last={i === rows.length - 1} />
                  </div>
                  <details className="border-t border-line">
                    <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-brand">Edit</summary>
                    <ActionForm action={saveTeamMemberAction} resetOnSuccess={false} className="space-y-4 px-5 pb-5">
                      <TeamFields uni={uni} row={m} />
                      <SubmitButton size="sm">Save team member</SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit">
          <CardTitle>Add someone</CardTitle>
          <ActionForm action={saveTeamMemberAction} className="space-y-4">
            <TeamFields uni={uni} />
            <SubmitButton>Add team member</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
