import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Select, Table, Td } from "@/components/ui";
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
    <>
      <PageHeader
        title="Marketplace"
        subtitle="Sell recorded courses, single lectures and combos, and seats in your live batches, to anyone on Zinny: your own students, other institutes' students and alumni, and independent learners."
        actions={
          <Link href={`/marketplace/institutes/${uni}`} className="text-[14px] font-medium text-brand hover:underline">
            See it as buyers do
          </Link>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {listings.length === 0 ? (
            <Empty title="Nothing on sale yet">
              {sources.length > 0 || batches.length > 0
                ? "List your first recording or live batch on the right, or from a course's Marketplace tab."
                : "Upload a video lesson to a course or open a batch, and you can list it here."}
            </Empty>
          ) : (
            <Table head={["Listing", "Type", "Price before GST", "Sold", "Status", ""]}>
              {listings.map((l) => (
                <tr key={l.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`${base}/${l.id}`} className="font-medium text-ink hover:text-brand">
                      {l.title}
                    </Link>
                    {l.includes.length > 0 && <div className="mt-0.5 text-[13px] text-muted">{l.includes.join(" + ")}</div>}
                    {l.batch && <div className="mt-0.5 text-[13px] text-muted">{batchLine(l.batch)}</div>}
                    {l.batch && STATE_NOTE[l.batch.state] && <div className="mt-1 max-w-md text-[13px] text-muted">{STATE_NOTE[l.batch.state]}</div>}
                  </Td>
                  <Td className="text-muted">{KIND_LABEL[l.kind]}</Td>
                  <Td className="tabular-nums">
                    {formatINR(l.pricePaise)}
                    {l.compareAtPaise && <s className="ml-2 text-[13px] text-muted">{formatINR(l.compareAtPaise)}</s>}
                  </Td>
                  <Td className="tabular-nums">
                    {l.buyers}
                    {l.batch && (
                      <div className="text-[13px] whitespace-nowrap text-muted">
                        sold here
                        <span className="block">
                          {l.batch.seatsTaken} of {l.batch.seatLimit} seats taken
                        </span>
                      </div>
                    )}
                  </Td>
                  <Td>{l.batch ? <BatchStateBadge state={l.batch.state} /> : <Badge tone={l.status === "live" ? "brand" : "neutral"}>{l.status === "live" ? "On sale" : "Paused"}</Badge>}</Td>
                  <Td>
                    <ActionForm action={setListingStatusAction} resetOnSuccess={false}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="listingId" value={l.id} />
                      <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
                      <SubmitButton variant="ghost" size="sm" pendingText="Saving…">
                        {l.status === "live" ? "Pause" : l.batch ? "Relist" : "Put back on sale"}
                      </SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle hint="A seat in a real batch">List a live batch</CardTitle>
            <ListBatchForm uni={uni} batches={batches} />
          </Card>

          {sources.length > 0 && (
            <Card>
              <CardTitle hint="Watch any time">List a recording</CardTitle>
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
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
