import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { updateListingAction } from "@/modules/marketplace/actions";
import { ListingFieldsInputs } from "@/modules/marketplace/components/admin";
import { getListing } from "@/modules/marketplace/listings";

export const metadata = { title: "Edit listing" };

export default async function EditListing({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  const listing = await getListing(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <Link href={`/${uni}/admin/marketplace`} className="text-sm text-muted hover:text-ink">
        Marketplace
      </Link>
      <PageHeader title={listing.title} subtitle="Changes show on the marketplace straight away. People who already bought it keep what they have." />
      <Card className="max-w-xl">
        <ActionForm action={updateListingAction} className="space-y-4" resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="listingId" value={listing.id} />
          <ListingFieldsInputs title={listing.title} description={listing.description} pricePaise={listing.pricePaise} compareAtPaise={listing.compareAtPaise} />
          <SubmitButton>Save listing</SubmitButton>
        </ActionForm>
      </Card>
      <p className="mt-4 max-w-xl text-[13px]">
        <Link href={`/marketplace/${listing.id}`} className="text-brand hover:underline">
          See this listing on the marketplace
        </Link>
      </p>
    </>
  );
}
