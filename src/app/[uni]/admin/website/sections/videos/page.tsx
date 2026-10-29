import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, PageHeader, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { saveVideoAction } from "@/modules/website-builder/actions";
import { NoAccess, SectionTabs, VisibilityBadge } from "@/modules/website-builder/components/admin";
import { ItemControls } from "@/modules/website-builder/components/item-controls";
import { listVideos } from "@/modules/website-builder/content";
import { attentionCounts } from "@/modules/website-builder/overview";
import { youtubeThumb, youtubeWatch } from "@/modules/website-builder/youtube";

export const metadata = { title: "Videos" };

type Row = Awaited<ReturnType<typeof listVideos>>[number];

function VideoFields({ uni, row }: { uni: string; row?: Row }) {
  return (
    <>
      <input type="hidden" name="uni" value={uni} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="YouTube link" hint="The address from the browser or the Share button.">
        <Input name="url" defaultValue={row ? youtubeWatch(row.youtubeId) : ""} required placeholder="https://www.youtube.com/watch?v=…" />
      </Field>
      <Field label="Title">
        <Input name="title" defaultValue={row?.title} required maxLength={120} placeholder="A day on campus" />
      </Field>
      <Field label="Description" hint="Optional. One sentence.">
        <Textarea name="description" defaultValue={row?.description} maxLength={400} rows={2} className="min-h-0 text-[14px]" />
      </Field>
    </>
  );
}

export default async function VideosPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Videos" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [rows, counts] = await Promise.all([listVideos(actor), attentionCounts(actor)]);

  return (
    <>
      <PageHeader title="Videos" subtitle="YouTube videos for the Videos section: campus tours, sample classes, convocation. They play on your website without leaving it." />
      <SectionTabs uni={uni} active="videos" counts={counts} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {rows.length === 0 ? (
            <Empty title="No videos yet">Paste a YouTube link on the right to add the first one.</Empty>
          ) : (
            <ul className="space-y-3">
              {rows.map((v, i) => (
                <li key={v.id} className={cx("rounded-[22px] border bg-surface", v.visible ? "border-line" : "border-dashed border-line bg-canvas/50")}>
                  <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                    <a href={youtubeWatch(v.youtubeId)} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Watch ${v.title} on YouTube`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={youtubeThumb(v.youtubeId)} alt="" width={128} height={72} className="h-[72px] w-32 rounded-xl border border-line object-cover" />
                    </a>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <span className="font-medium">{v.title}</span>
                        <VisibilityBadge visible={v.visible} />
                      </div>
                      {v.description && <p className="mt-1 line-clamp-2 text-[14px] text-muted">{v.description}</p>}
                    </div>
                    <ItemControls uni={uni} collection="videos" id={v.id} visible={v.visible} name={`the video “${v.title}”`} first={i === 0} last={i === rows.length - 1} />
                  </div>
                  <details className="border-t border-line">
                    <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-brand">Edit</summary>
                    <ActionForm action={saveVideoAction} resetOnSuccess={false} className="space-y-4 px-5 pb-5">
                      <VideoFields uni={uni} row={v} />
                      <SubmitButton size="sm">Save video</SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit">
          <CardTitle>Add a video</CardTitle>
          <ActionForm action={saveVideoAction} className="space-y-4">
            <VideoFields uni={uni} />
            <SubmitButton>Add video</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
