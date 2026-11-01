import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatINR } from "@/server/services/finance";
import { createListingAction, setListingStatusAction } from "@/modules/marketplace/actions";
import { listableSources, listListings } from "@/modules/marketplace/listings";

export const metadata = { title: "Marketplace" };

export default async function MarketplaceListings({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const [listings, sources] = await Promise.all([listListings(actor), listableSources(actor)]);

  return (
    <>
      <PageHeader
        title="Marketplace"
        subtitle="Sell recorded courses and single video lectures to independent learners and alumni of other institutes. Your own students aren't affected."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          {listings.length === 0 ? (
            <Empty title="Nothing on sale yet">
              {sources.length > 0 ? "List your first course or lecture on the right." : "Upload a video lesson to a course, and you can list it here."}
            </Empty>
          ) : (
            <Table head={["Listing", "Type", "Price before GST", "Buyers", "Status", ""]}>
              {listings.map((l) => (
                <tr key={l.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`/${uni}/admin/products/marketplace/${l.id}`} className="font-medium text-ink hover:text-brand">
                      {l.title}
                    </Link>
                  </Td>
                  <Td className="text-muted">{l.kind === "lecture" ? "Lecture" : "Course"}</Td>
                  <Td className="tabular-nums">{formatINR(l.pricePaise)}</Td>
                  <Td className="tabular-nums">{l.buyers}</Td>
                  <Td>
                    <Badge tone={l.status === "live" ? "brand" : "neutral"}>{l.status === "live" ? "On sale" : "Paused"}</Badge>
                  </Td>
                  <Td>
                    <ActionForm action={setListingStatusAction} resetOnSuccess={false}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="listingId" value={l.id} />
                      <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
                      <SubmitButton variant="ghost" size="sm" pendingText="Saving…">
                        {l.status === "live" ? "Pause" : "Put back on sale"}
                      </SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        {sources.length > 0 && (
          <Card>
            <CardTitle>List for sale</CardTitle>
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
              <Field label="Title on the marketplace">
                <Input name="title" required minLength={3} maxLength={120} placeholder="Data analytics, recorded" />
              </Field>
              <Field label="Description" hint="What buyers will learn, and who it's for.">
                <Textarea name="description" maxLength={2000} />
              </Field>
              <Field label="Price before GST (₹)" hint="GST is added at the course's rate. Separate from what your own students pay.">
                <Input name="price" required inputMode="decimal" placeholder="1499" />
              </Field>
              <SubmitButton pendingText="Listing…">List on the marketplace</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
