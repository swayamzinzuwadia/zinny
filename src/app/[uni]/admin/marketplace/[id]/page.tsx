import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Notice, PageHeader, Stat } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { removeListingAction, setListingStatusAction, updateListingAction } from "@/modules/marketplace/actions";
import { BatchStateBadge, LateJoinInput, ListingFieldsInputs, STATE_NOTE, batchLine } from "@/modules/marketplace/components/admin";
import { getListing } from "@/modules/marketplace/listings";

export const metadata = { title: "Edit listing" };

export default async function EditListing({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const listing = await getListing(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const batch = listing.batch;
  const offered = batch ? batch.state === "on_sale" || batch.state === "full" : listing.status === "live";

  return (
    <>
      <Link href={`/${uni}/admin/marketplace`} className="text-sm text-muted hover:text-ink">
        Marketplace
      </Link>
      <PageHeader
        title={listing.title}
        subtitle={
          batch
            ? `Live batch: ${batchLine(batch)}. Changes show on the marketplace straight away. People who already bought a seat keep it.`
            : "Changes show on the marketplace straight away. People who already bought it keep what they have."
        }
        actions={batch ? <BatchStateBadge state={batch.state} /> : undefined}
      />
      {batch && (
        <div className="mb-6 grid max-w-3xl gap-4 sm:grid-cols-3">
          <Stat label="Sold on the marketplace" value={listing.buyers} hint={listing.buyers === 1 ? "seat" : "seats"} />
          <Stat label="Seats taken in the batch" value={`${batch.seatsTaken} of ${batch.seatLimit}`} hint="Your own students included" />
          <Stat label="Seats free" value={Math.max(0, batch.seatLimit - batch.seatsTaken)} />
        </div>
      )}
      {batch && STATE_NOTE[batch.state] && (
        <div className="mb-6 max-w-xl">
          <Notice tone="gold">{STATE_NOTE[batch.state]}</Notice>
        </div>
      )}
      <Card className="max-w-xl">
        <ActionForm action={updateListingAction} className="space-y-4" resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="listingId" value={listing.id} />
          <ListingFieldsInputs title={listing.title} description={listing.description} pricePaise={listing.pricePaise} compareAtPaise={listing.compareAtPaise} />
          {batch && <LateJoinInput checked={listing.lateJoin} />}
          <SubmitButton>Save listing</SubmitButton>
        </ActionForm>
      </Card>

      {batch && (
        <Card className="mt-6 max-w-xl">
          <CardTitle>Take it off the marketplace</CardTitle>
          <p className="text-[14px] text-muted">
            Pause it to stop new sales for now; relist it whenever you like. Remove it to take it off for good: buyers keep their seats, and the batch can be listed again later as a new listing.
          </p>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <ActionForm action={setListingStatusAction} resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="listingId" value={listing.id} />
              <input type="hidden" name="status" value={listing.status === "live" ? "paused" : "live"} />
              <SubmitButton variant="secondary" pendingText="Saving…">
                {listing.status === "live" ? "Pause listing" : "Relist on the marketplace"}
              </SubmitButton>
            </ActionForm>
            <ActionForm action={removeListingAction} resetOnSuccess={false} confirm="Remove this batch from the marketplace? People who bought a seat keep it.">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="listingId" value={listing.id} />
              <SubmitButton variant="danger" pendingText="Removing…">
                Remove from the marketplace
              </SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}

      {offered && (
        <p className="mt-4 max-w-xl text-[13px]">
          <Link href={`/marketplace/${listing.id}`} className="text-brand hover:underline">
            See this listing on the marketplace
          </Link>
        </p>
      )}
    </>
  );
}
