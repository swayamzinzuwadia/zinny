import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { updateSectionAction } from "../actions";
import { mediaPath } from "../media";
import { LIMIT_OPTIONS, LIMITS, type PageSection } from "../sections";
import { ImageField } from "./image-field";

/** Where each section's content is managed (path under /<uni>/admin), for a link under its editor. */
const CONTENT_LINK: Partial<Record<PageSection["type"], [string, string]>> = {
  about: ["website/profile", "Edit the About text in the institute profile"],
  courses: ["products/courses", "Manage courses"],
  faculty: ["website/profile/faculty", "Approve faculty profiles"],
  testimonials: ["website/sections/testimonials", "Manage testimonials"],
  reviews: ["website/sections/reviews", "Moderate reviews"],
  gallery: ["website/sections/gallery", "Manage the gallery"],
  videos: ["website/sections/videos", "Manage videos"],
  blog: ["website/sections/blog", "Write blog posts"],
  team: ["website/sections/team", "Manage the team"],
  enquiry: ["website/sections/enquiries", "Open the enquiries inbox"],
  contact: ["website/profile", "Edit contact details in the institute profile"],
};

const limitLabel = (type: PageSection["type"], n: number) =>
  type === "courses" ? (n === 0 ? "All published courses" : `${n} courses`) : type === "gallery" ? `${n} photos` : `${n} posts`;

export function SectionEditor({ uni, section }: { uni: string; section: PageSection }) {
  const link = CONTENT_LINK[section.type];
  const href = link ? `/${uni}/admin/${link[0]}` : null;
  return (
    <ActionForm action={updateSectionAction} resetOnSuccess={false} className="space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="type" value={section.type} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Heading">
          <Input name="heading" defaultValue={section.heading} maxLength={LIMITS.heading} required />
        </Field>
        {LIMIT_OPTIONS[section.type] && (
          <Field label="How many to show">
            <Select name="limit" defaultValue={String(section.limit ?? 0)}>
              {LIMIT_OPTIONS[section.type]!.map((n) => (
                <option key={n} value={n}>
                  {limitLabel(section.type, n)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label={section.type === "hero" ? "Text under the heading" : "Introduction"} hint="Optional. One or two sentences.">
        <Textarea name="intro" defaultValue={section.intro} rows={2} maxLength={LIMITS.intro} className="min-h-0 text-[14px]" />
      </Field>

      {section.type === "hero" && (
        <>
          <ImageField
            key={section.imageMediaId ?? "none"}
            uni={uni}
            kind="hero"
            name="imageMediaId"
            label="Picture"
            hint="Leave empty to use the cover image from the institute profile."
            initial={section.imageMediaId ? { id: section.imageMediaId, src: mediaPath(uni, section.imageMediaId) } : null}
          />
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" name="showNextBatch" defaultChecked={section.showNextBatch} className="h-4 w-4 accent-[#0b5e4c]" />
            Show when the next batch starts
          </label>
        </>
      )}

      {section.type === "about" && (
        <>
          <Field label="Text" hint="Leave empty to use the About text from the institute profile.">
            <Textarea name="body" defaultValue={section.body} rows={6} maxLength={LIMITS.body} className="text-[14px]" />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Highlights</legend>
            <p className="mb-2 text-[12px] text-muted">Up to four short facts, like “1998” and “Founded”, or “92%” and “Placed within six months”.</p>
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="grid grid-cols-[120px_1fr] gap-2">
                  <Input name={`hlValue${i}`} defaultValue={section.highlights?.[i]?.value ?? ""} placeholder="Figure" maxLength={LIMITS.highlightValue} aria-label={`Highlight ${i + 1} figure`} />
                  <Input name={`hlLabel${i}`} defaultValue={section.highlights?.[i]?.label ?? ""} placeholder="What it means" maxLength={LIMITS.highlightLabel} aria-label={`Highlight ${i + 1} label`} />
                </div>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {section.type === "reviews" && (
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" name="allowSubmissions" defaultChecked={section.allowSubmissions} className="h-4 w-4 accent-[#0b5e4c]" />
          Let visitors write a review (you approve each one first)
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {href ? (
          <Link href={href} className="text-[13px] text-brand underline underline-offset-2">
            {link![1]}
          </Link>
        ) : (
          <span />
        )}
        <SubmitButton size="sm">Save to draft</SubmitButton>
      </div>
    </ActionForm>
  );
}
