import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { updateListingAction } from "@/modules/marketplace/actions";
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
      <PageHeader title={listing.title} subtitle="Changes show on the marketplace straight away. People who already bought it keep what they have." />
      <Card className="max-w-xl">
        <ActionForm action={updateListingAction} className="space-y-4" resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="listingId" value={listing.id} />
          <Field label="Title on the marketplace">
            <Input name="title" required minLength={3} maxLength={120} defaultValue={listing.title} />
          </Field>
          <Field label="Description">
            <Textarea name="description" maxLength={2000} defaultValue={listing.description} />
          </Field>
          <Field label="Price before GST (₹)">
            <Input name="price" required inputMode="decimal" defaultValue={String(listing.pricePaise / 100)} />
          </Field>
          <SubmitButton>Save listing</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
