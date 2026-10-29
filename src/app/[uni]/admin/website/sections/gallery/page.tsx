import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Empty, Input, PageHeader, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { addGalleryPhotosAction, saveGalleryCaptionAction } from "@/modules/website-builder/actions";
import { NoAccess, SectionTabs, VisibilityBadge } from "@/modules/website-builder/components/admin";
import { GalleryUploader } from "@/modules/website-builder/components/gallery-uploader";
import { ItemControls } from "@/modules/website-builder/components/item-controls";
import { listGallery } from "@/modules/website-builder/content";
import { mediaPath } from "@/modules/website-builder/media";
import { attentionCounts } from "@/modules/website-builder/overview";

export const metadata = { title: "Gallery" };

export default async function GalleryPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Gallery" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [rows, counts] = await Promise.all([listGallery(actor), attentionCounts(actor)]);

  return (
    <>
      <PageHeader
        title="Gallery"
        subtitle="Photos of your campus, classes and events. The website shows them in this order; the Gallery section's settings decide how many."
        actions={<GalleryUploader uni={uni} add={addGalleryPhotosAction} />}
      />
      <SectionTabs uni={uni} active="gallery" counts={counts} />
      {rows.length === 0 ? (
        <Empty title="No photos yet">Upload a few photos of your campus and classes. Wide photos look best.</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ item, media }, i) => (
            <li key={item.id}>
              <Card className={cx("flex h-full flex-col gap-3 p-3", !item.visible && "border-dashed bg-canvas/50")}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-canvas">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaPath(uni, media.id)} alt={item.caption} loading="lazy" className={cx("h-full w-full object-cover", !item.visible && "opacity-60")} />
                  <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-0.5">
                    <VisibilityBadge visible={item.visible} />
                  </span>
                </div>
                <ActionForm action={saveGalleryCaptionAction} resetOnSuccess={false} className="flex gap-2">
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="id" value={item.id} />
                  <Input name="caption" defaultValue={item.caption} maxLength={160} placeholder="Caption (also read aloud by screen readers)" aria-label="Caption" className="h-9 text-[13px]" />
                  <SubmitButton variant="secondary" size="sm">
                    Save
                  </SubmitButton>
                </ActionForm>
                <div className="mt-auto">
                  <ItemControls uni={uni} collection="gallery" id={item.id} visible={item.visible} name="this photo" first={i === 0} last={i === rows.length - 1} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
