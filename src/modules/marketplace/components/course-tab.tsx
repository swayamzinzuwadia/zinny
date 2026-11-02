import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Notice, Select } from "@/components/ui";
import type { CourseTabProps } from "@/contracts/module";
import { inr } from "@/modules/payments/money";
import { createListingAction, setListingStatusAction } from "../actions";
import { courseMarketplace } from "../listings";
import { ListingFieldsInputs } from "./admin";

type Listed = { id: string; title: string; status: "live" | "paused"; pricePaise: number; compareAtPaise: number | null; buyers: number };

function ListedRow({ uni, l }: { uni: string; l: Listed }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link href={`/${uni}/admin/marketplace/${l.id}`} className="font-medium hover:text-brand">
          {l.title}
        </Link>
        <div className="mt-0.5 text-[13px] text-muted">
          {inr(l.pricePaise)} before GST
          {l.compareAtPaise && (
            <>
              {" "}
              · usually <s>{inr(l.compareAtPaise)}</s>
            </>
          )}{" "}
          · {l.buyers} {l.buyers === 1 ? "buyer" : "buyers"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={l.status === "live" ? "brand" : "neutral"}>{l.status === "live" ? "On sale" : "Paused"}</Badge>
        <ActionForm action={setListingStatusAction} resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="listingId" value={l.id} />
          <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
          <SubmitButton variant="ghost" size="sm" pendingText="Saving…">
            {l.status === "live" ? "Pause" : "Put back on sale"}
          </SubmitButton>
        </ActionForm>
        <Link href={`/${uni}/admin/marketplace/${l.id}`} className="text-[14px] text-brand hover:underline">
          Edit price
        </Link>
      </div>
    </div>
  );
}

/** Course editor → Marketplace (adminCourseTabs.marketplace): sell this course, or single lectures from it, to anyone on Zinny. */
export async function MarketplaceCourseTab({ uni, actor, course }: CourseTabProps) {
  const m = await courseMarketplace(actor, course.id);
  const admin = `/${uni}/admin/marketplace`;

  if (m.videos === 0) {
    return (
      <Notice tone="neutral">
        Nothing here can be sold yet. Upload a video lesson in{" "}
        <Link href={`/${uni}/admin/products/courses/${course.id}?tab=curriculum`} className="font-medium underline underline-offset-2">
          Curriculum
        </Link>
        , then come back to put this course or single lectures from it on the marketplace.
      </Notice>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardTitle hint="Every recorded lesson in it">The whole course</CardTitle>
        {m.whole ? (
          <ListedRow uni={uni} l={m.whole} />
        ) : (
          <ActionForm action={createListingAction} className="space-y-4">
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="source" value={`course:${course.id}`} />
            <p className="text-[14px] text-muted">
              Sell the recordings of this course to anyone on Zinny. Your own students keep learning in their batches as before.
            </p>
            <ListingFieldsInputs title={`${m.course.title}: the full recordings`} description={m.course.description} />
            <SubmitButton pendingText="Listing…">Publish on the marketplace</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card>
        <CardTitle hint={`${m.videos} video ${m.videos === 1 ? "lesson" : "lessons"}`}>Single lectures</CardTitle>
        {m.lectures.length > 0 && (
          <div className="mb-4 divide-y divide-line">
            {m.lectures.map((l) => (
              <ListedRow key={l.id} uni={uni} l={l} />
            ))}
          </div>
        )}
        {m.unlistedLectures.length > 0 ? (
          <ActionForm action={createListingAction} className="space-y-4">
            <input type="hidden" name="uni" value={uni} />
            <Field label="Lecture to sell" hint="Buyers get this one video lesson and nothing else.">
              <Select name="source" required defaultValue="">
                <option value="" disabled>
                  Choose a video lesson
                </option>
                {m.unlistedLectures.map((l) => (
                  <option key={l.id} value={`lecture:${l.id}`}>
                    {l.title}
                  </option>
                ))}
              </Select>
            </Field>
            <ListingFieldsInputs titlePlaceholder="A lecture title buyers will understand" />
            <SubmitButton pendingText="Listing…">Publish the lecture</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-[14px] text-muted">Every video lesson in this course is on sale on its own.</p>
        )}
      </Card>

      <Card className="xl:col-span-2">
        <CardTitle>Combos and deals</CardTitle>
        {m.combos.length > 0 ? (
          <ul className="mb-3 space-y-1 text-[14px]">
            {m.combos.map((c) => (
              <li key={c.id}>
                <Link href={`${admin}/${c.id}`} className="font-medium hover:text-brand">
                  {c.title}
                </Link>{" "}
                <span className="text-muted">{c.status === "live" ? "on sale" : "paused"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-[14px] text-muted">This course isn&apos;t in a combo yet.</p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          <Link href={`${admin}/combos`} className="font-medium text-brand hover:underline">
            Make a combo
          </Link>
          <Link href={`${admin}/codes`} className="font-medium text-brand hover:underline">
            Make a discount code
          </Link>
          <Link href={admin} className="text-muted hover:text-ink">
            All marketplace listings
          </Link>
        </div>
      </Card>
    </div>
  );
}
