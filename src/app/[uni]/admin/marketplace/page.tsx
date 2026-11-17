import Link from "next/link";
import { Panel, PanelButton, Panels } from "@/components/panel";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, PageHeader, Select, ActionLink } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatINR } from "@/server/services/finance";
import { createListingAction, setListingStatusAction } from "@/modules/marketplace/actions";
import { BatchStateBadge, KIND_LABEL, ListBatchForm, ListingFieldsInputs, STATE_NOTE, batchLine } from "@/modules/marketplace/components/admin";
import { listableBatches, listableSources, listListings } from "@/modules/marketplace/listings";

export const metadata = { title: "Marketplace" };

export default async function MarketplaceListings({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const [listings, sources, batches] = await Promise.all([listListings(actor), listableSources(actor), listableBatches(actor)]);
  const base = `/${uni}/admin/marketplace`;

  return (
    // The listings have the page; the two forms that add one wait behind their buttons.
    <Panels>
      <PageHeader
        title="Marketplace"
        subtitle="Sell recorded courses, single lectures and combos, and seats in your live batches, to anyone on Zinny: your own students, other institutes' students and alumni, and independent learners."
        actions={
          <>
            <ActionLink href={`/marketplace/institutes/${uni}`} icon="view" size="md">
              See it as buyers do
            </ActionLink>
            {sources.length > 0 && (
              <PanelButton panel="recording" variant="secondary" icon="add">
                List a recording
              </PanelButton>
            )}
            <PanelButton panel="batch" icon="add">
              List a live batch
            </PanelButton>
          </>
        }
      />
      <Panel id="batch" title="List a live batch" hint="A seat in a real batch" className="max-w-2xl">
        <ListBatchForm uni={uni} batches={batches} />
      </Panel>
      {sources.length > 0 && (
        <Panel id="recording" title="List a recording" hint="Watch any time" className="max-w-2xl">
          <ActionForm action={createListingAction} className="space-y-4">
            <input type="hidden" name="uni" value={uni} />
            <Field label="What to sell" hint="Only ready video lessons can be sold. A whole course includes everything in it.">
              <Select name="source" required defaultValue="">
                <option value="" disabled>
                  Choose a course or lecture
                </option>
                {sources.map((s) => (
                  <optgroup key={s.id} label={s.title}>
                    {s.canSellWhole && <option value={`course:${s.id}`}>Whole course: {s.title}</option>}
                    {s.lectures.map((l) => (
                      <option key={l.id} value={`lecture:${l.id}`}>
                        Lecture: {l.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <ListingFieldsInputs titlePlaceholder="Data analytics, recorded" />
            <SubmitButton pendingText="Listing…">List on the marketplace</SubmitButton>
          </ActionForm>
        </Panel>
      )}
      <div className="space-y-6">
        <div>
          {listings.length > 0 && <p className="mb-3 text-[13px] text-muted">{listings.length} listing{listings.length === 1 ? "" : "s"}. Prices are before GST.</p>}
          {listings.length === 0 ? (
            <Empty title="Nothing on sale yet">
              {sources.length > 0 || batches.length > 0
                ? "List your first recording or live batch with the buttons above, or from a course's Selling tab."
                : "Upload a video lesson to a course or open a batch, and you can list it here."}
            </Empty>
          ) : (
            <Card className="p-0!">
              <ul className="divide-y divide-line">
                {listings.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-3">
                    <div className="min-w-0 flex-1 basis-64 text-[14px]">
                      <div>
                        <Link href={`${base}/${l.id}`} className="font-medium text-ink hover:text-brand">
                          {l.title}
                        </Link>
                        <span className="text-[13px] text-muted"> · {KIND_LABEL[l.kind]}</span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted">
                        {[
                          l.includes.length > 0 ? l.includes.join(" + ") : null,
                          l.batch ? batchLine(l.batch) : null,
                          l.batch ? `${l.batch.seatsTaken} of ${l.batch.seatLimit} seats taken` : null,
                          `${l.buyers} sold${l.batch ? " here" : ""}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {l.batch && STATE_NOTE[l.batch.state] && <div className="mt-0.5 max-w-xl text-[13px] text-muted">{STATE_NOTE[l.batch.state]}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="tabular whitespace-nowrap text-[14px]" title="Price before GST">
                        {formatINR(l.pricePaise)}
                        {l.compareAtPaise && <s className="ml-2 text-[13px] text-muted">{formatINR(l.compareAtPaise)}</s>}
                      </span>
                      {l.batch ? <BatchStateBadge state={l.batch.state} /> : <Badge tone={l.status === "live" ? "brand" : "neutral"}>{l.status === "live" ? "On sale" : "Paused"}</Badge>}
                      <ActionForm action={setListingStatusAction} resetOnSuccess={false}>
                        <input type="hidden" name="uni" value={uni} />
                        <input type="hidden" name="listingId" value={l.id} />
                        <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
                        <SubmitButton variant="ghost" size="sm" pendingText="Saving…">
                          {l.status === "live" ? "Pause" : l.batch ? "Relist" : "Put back on sale"}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

      </div>
    </Panels>
  );
}
