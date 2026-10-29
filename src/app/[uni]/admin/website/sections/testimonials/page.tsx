import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, PageHeader, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { saveTestimonialAction } from "@/modules/website-builder/actions";
import { NoAccess, SectionTabs, Thumb, VisibilityBadge } from "@/modules/website-builder/components/admin";
import { ImageField } from "@/modules/website-builder/components/image-field";
import { ItemControls } from "@/modules/website-builder/components/item-controls";
import { listTestimonials } from "@/modules/website-builder/content";
import { mediaPath } from "@/modules/website-builder/media";
import { attentionCounts } from "@/modules/website-builder/overview";

export const metadata = { title: "Testimonials" };

type Row = Awaited<ReturnType<typeof listTestimonials>>[number];

function TestimonialFields({ uni, row }: { uni: string; row?: Row }) {
  return (
    <>
      <input type="hidden" name="uni" value={uni} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Name">
        <Input name="name" defaultValue={row?.name} required maxLength={80} placeholder="Priya Menon" />
      </Field>
      <Field label="Course or role" hint="Optional, like “Data Analytics, class of 2025”.">
        <Input name="byline" defaultValue={row?.byline} maxLength={120} />
      </Field>
      <Field label="What they said">
        <Textarea name="quote" defaultValue={row?.quote} required minLength={10} maxLength={600} rows={4} className="text-[14px]" />
      </Field>
      <ImageField
        key={row?.photoMediaId ?? "none"}
        uni={uni}
        kind="testimonial"
        name="photoMediaId"
        label="Photo"
        shape="square"
        hint="Optional. Only with their permission."
        initial={row?.photoMediaId ? { id: row.photoMediaId, src: mediaPath(uni, row.photoMediaId) } : null}
      />
    </>
  );
}

export default async function TestimonialsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Testimonials" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [rows, counts] = await Promise.all([listTestimonials(actor), attentionCounts(actor)]);

  return (
    <>
      <PageHeader title="Testimonials" subtitle="Quotes from students and alumni, shown in this order in the Testimonials section of your website." />
      <SectionTabs uni={uni} active="testimonials" counts={counts} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {rows.length === 0 ? (
            <Empty title="No testimonials yet">Add the first one on the right. Short, specific quotes work best.</Empty>
          ) : (
            <ul className="space-y-3">
              {rows.map((t, i) => (
                <li key={t.id} className={cx("rounded-[22px] border bg-surface", t.visible ? "border-line" : "border-dashed border-line bg-canvas/50")}>
                  <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                    <Thumb src={t.photoMediaId ? mediaPath(uni, t.photoMediaId) : null} name={t.name} size={48} round />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <span className="font-medium">{t.name}</span>
                        <VisibilityBadge visible={t.visible} />
                      </div>
                      {t.byline && <div className="text-[13px] text-muted">{t.byline}</div>}
                      <p className="mt-2 line-clamp-3 max-w-2xl text-[14px] text-ink/85">“{t.quote}”</p>
                    </div>
                    <ItemControls uni={uni} collection="testimonials" id={t.id} visible={t.visible} name={`the testimonial from ${t.name}`} first={i === 0} last={i === rows.length - 1} />
                  </div>
                  <details className="border-t border-line">
                    <summary className="cursor-pointer px-5 py-2.5 text-[13px] text-brand">Edit</summary>
                    <ActionForm action={saveTestimonialAction} resetOnSuccess={false} className="space-y-4 px-5 pb-5">
                      <TestimonialFields uni={uni} row={t} />
                      <SubmitButton size="sm">Save testimonial</SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card className="h-fit">
          <CardTitle>Add a testimonial</CardTitle>
          <ActionForm action={saveTestimonialAction} className="space-y-4">
            <TestimonialFields uni={uni} />
            <SubmitButton>Add testimonial</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
