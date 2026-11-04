import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, PageHeader, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatINR } from "@/server/services/finance";
import { createComboAction } from "@/modules/marketplace/actions";
import { ListingFieldsInputs } from "@/modules/marketplace/components/admin";
import { comboSources, listListings } from "@/modules/marketplace/listings";

export const metadata = { title: "Combos" };

export default async function Combos({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const [listings, sources] = await Promise.all([listListings(actor), comboSources(actor)]);
  const combos = listings.filter((l) => l.kind === "combo");

  return (
    <>
      <PageHeader title="Combos" subtitle="A combo sells several of your courses together at one price, as a single course with a section for each." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          {combos.length === 0 ? (
            <Empty title="No combos yet">
              {sources.length >= 2 ? "Pick two or more courses on the right and set one price for them all." : "You need at least two courses with recorded video lessons to make a combo."}
            </Empty>
          ) : (
            <Table head={["Combo", "Price before GST", "Buyers", "Status"]}>
              {combos.map((c) => (
                <tr key={c.id} className="hover:bg-canvas/60">
                  <Td>
                    <Link href={`/${uni}/admin/marketplace/${c.id}`} className="font-medium text-ink hover:text-brand">
                      {c.title}
                    </Link>
                    <div className="mt-0.5 text-[13px] text-muted">{c.includes.join(" + ")}</div>
                  </Td>
                  <Td className="tabular-nums">
                    {formatINR(c.pricePaise)}
                    {c.compareAtPaise && <s className="ml-2 text-[13px] text-muted">{formatINR(c.compareAtPaise)}</s>}
                  </Td>
                  <Td className="tabular-nums">{c.buyers}</Td>
                  <Td>
                    <Badge tone={c.status === "live" ? "brand" : "neutral"}>{c.status === "live" ? "On sale" : "Paused"}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-4 text-[13px] text-muted">
            A combo copies the recorded lessons its courses have today. Lessons you add to those courses later don&apos;t reach people who bought the combo. Pause or
            reprice a combo under Marketplace, Listings.
          </p>
        </div>

        {sources.length >= 2 && (
          <Card>
            <CardTitle>Make a combo</CardTitle>
            <ActionForm action={createComboAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Courses in the combo" hint="Two to ten courses, in the order buyers will see them.">
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-2">
                  {sources.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-[14px] hover:bg-canvas">
                      <input type="checkbox" name="courseIds" value={s.id} className="size-4 accent-[var(--color-brand)]" />
                      {s.title}
                    </label>
                  ))}
                </div>
              </Field>
              <ListingFieldsInputs titlePlaceholder="Data career starter pack" />
              <SubmitButton pendingText="Making the combo…">List the combo</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
