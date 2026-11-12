import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { reach } from "@/server/core";
import { spaceContext } from "@/server/context";
import { formatINR } from "@/server/services/finance";
import { createCodeAction, setCodeStatusAction } from "@/modules/marketplace/actions";
import { listCodes, listListings } from "@/modules/marketplace/listings";

export const metadata = { title: "Discount codes" };

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmt = (d: string) => day.format(new Date(`${d}T00:00:00Z`));

function when(startsOn: string | null, endsOn: string | null) {
  if (startsOn && endsOn) return `${fmt(startsOn)} to ${fmt(endsOn)}`;
  if (startsOn) return `From ${fmt(startsOn)}`;
  if (endsOn) return `Until ${fmt(endsOn)}`;
  return "Any time";
}

export default async function Codes({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const [codes, listings] = await Promise.all([listCodes(actor), listListings(actor)]);
  const everything = reach(actor, "course.update", university.id).all;

  return (
    <>
      <PageHeader title="Discount codes" subtitle="Codes buyers type on a listing before they pay. They come off the price before GST, and the price never drops below ₹1." />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          {codes.length === 0 ? (
            <Empty title="No discount codes yet">Make one on the right, then share it with the people you want to reach.</Empty>
          ) : (
            <Table head={["Code", "Takes off", "Works on", "When", "Used", ""]}>
              {codes.map((c) => (
                <tr key={c.id} className="hover:bg-canvas/60">
                  <Td>
                    <span className="font-mono font-medium">{c.code}</span>
                    {c.status === "paused" && (
                      <span className="ml-2">
                        <Badge>Paused</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{c.kind === "percent" ? `${c.value}%` : formatINR(c.value)}</Td>
                  <Td className="text-muted">{c.listingTitle ?? "Everything you sell"}</Td>
                  <Td className="text-muted">{when(c.startsOn, c.endsOn)}</Td>
                  <Td className="tabular-nums">
                    {c.uses}
                    {c.maxUses !== null && ` of ${c.maxUses}`}
                  </Td>
                  <Td>
                    <ActionForm action={setCodeStatusAction} resetOnSuccess={false}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="codeId" value={c.id} />
                      <input type="hidden" name="status" value={c.status === "active" ? "paused" : "active"} />
                      <SubmitButton variant="ghost" size="sm" pendingText="Saving…">
                        {c.status === "active" ? "Pause" : "Switch back on"}
                      </SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        {(everything || listings.length > 0) && (
          <Card>
            <CardTitle>Make a code</CardTitle>
            <ActionForm action={createCodeAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Code" hint="Letters, numbers, - or _. Buyers can type it in any case.">
                <Input name="code" required minLength={3} maxLength={24} placeholder="DIWALI20" className="uppercase" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Takes off">
                  <Select name="kind" defaultValue="percent">
                    <option value="percent">A percentage</option>
                    <option value="amount">An amount in ₹</option>
                  </Select>
                </Field>
                <Field label="How much" hint="Up to 90%, or rupees.">
                  <Input name="value" required inputMode="decimal" placeholder="20" />
                </Field>
              </div>
              <Field label="Works on">
                <Select name="listingId" defaultValue={everything ? "" : listings[0]?.id}>
                  {everything && <option value="">Everything you sell</option>}
                  {listings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First day" hint="Optional.">
                  <Input name="startsOn" type="date" />
                </Field>
                <Field label="Last day" hint="Optional.">
                  <Input name="endsOn" type="date" />
                </Field>
              </div>
              <Field label="Limit" hint="Optional. How many purchases can use it.">
                <Input name="maxUses" inputMode="numeric" placeholder="100" />
              </Field>
              <SubmitButton pendingText="Making the code…">Make the code</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
