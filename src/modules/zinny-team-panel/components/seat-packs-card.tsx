/**
 * The licence page's seat packs: what the licence holds, adding and removing packs, caps set
 * by hand (platform.seat_pricing) and the history. The actions come from the page's route.
 */
import Link from "next/link";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { formatDate, formatDateTime, formatINR, todayIST } from "../lib/format";
import { describePacks, PACK_KINDS, type PackKind } from "../lib/seat-packs";
import { describeSeatEvent, type seatPacksFor } from "../services/seat-packs";
import { SeatPackForm } from "./seat-pack-form";

type Data = Awaited<ReturnType<typeof seatPacksFor>>;

export function SeatPacksCard({
  data,
  universityId,
  today,
  gstRateBp,
  intraState,
  canEditCaps,
  canEditPricing,
  actions,
}: {
  data: Data;
  universityId: string;
  today: string;
  gstRateBp: number;
  intraState: boolean;
  canEditCaps: boolean;
  canEditPricing: boolean;
  actions: { add: FormAction; remove: FormAction; caps: FormAction };
}) {
  const { licence, pricing, held, purchases, history, term } = data;
  if (!licence || !term) return null;
  const ended = today > licence.endDate;
  const anyHeld = held.student.packs + held.staff.packs > 0;

  return (
    <Card>
      <CardTitle hint={canEditPricing ? <Link href="/platform/billing/settings#seat-packs" className="hover:text-brand">Pack prices</Link> : undefined}>Seat packs</CardTitle>

      <dl className="grid grid-cols-2 gap-4 text-[14px]">
        {PACK_KINDS.map((k) => (
          <div key={k}>
            <dt className="text-[12.5px] text-muted">{k === "student" ? "Student packs" : "Staff packs"}</dt>
            <dd className="mt-0.5 font-medium">{held[k].packs > 0 ? describePacks(k, held[k].packs, held[k].seats) : "None"}</dd>
            <dd className="text-[12.5px] text-muted">
              {pricing[k].size} {k === "student" ? "students" : "staff"} for {formatINR(pricing[k].yearPricePaise)} a year
              {pricing[k].fromPlan ? " (this plan's price)" : ""}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12.5px] text-muted">
        Packs are part of the caps: {licence.studentCap.toLocaleString("en-IN")} students and {licence.staffCap.toLocaleString("en-IN")} staff in all. They renew with the licence at the pack
        price then. {term.daysLeft} of {term.termDays} days are left in this term.
      </p>

      <div className="mt-5 space-y-5 border-t border-line pt-5">
        <section className="space-y-3">
          <h3 className="text-[14px] font-medium">Add packs</h3>
          {ended ? (
            <p className="text-[13px] text-muted">This licence ended on {formatDate(licence.endDate)}. Renew it first, then add packs.</p>
          ) : (
            <SeatPackForm action={actions.add} pricing={pricing} term={licence} today={today} gstRateBp={gstRateBp} intraState={intraState} hidden={{ universityId }} mode="zinny" />
          )}
        </section>

        {anyHeld && (
          <section className="space-y-3 border-t border-line pt-5">
            <h3 className="text-[14px] font-medium">Remove packs</h3>
            <ActionForm action={actions.remove} className="space-y-3" confirm="Remove these packs? Their seats come off the cap straight away.">
              <input type="hidden" name="universityId" value={universityId} />
              <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
                <Field label="Pack">
                  <Select name="kind" defaultValue={held.student.packs > 0 ? "student" : "staff"}>
                    {PACK_KINDS.filter((k) => held[k].packs > 0).map((k: PackKind) => (
                      <option key={k} value={k}>
                        {k === "student" ? "Student packs" : "Staff packs"} ({held[k].packs} on the licence)
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="How many">
                  <Input name="packs" inputMode="numeric" defaultValue="1" required />
                </Field>
              </div>
              <Field label="Why" hint="The newest packs come off first. Invoices already raised stay as they are.">
                <Input name="note" maxLength={300} required placeholder="Second batch cancelled" />
              </Field>
              <SubmitButton variant="danger" pendingText="Removing…">
                Remove packs
              </SubmitButton>
            </ActionForm>
          </section>
        )}

        {canEditCaps && (
          <section className="space-y-3 border-t border-line pt-5">
            <h3 className="text-[14px] font-medium">Set the caps by hand</h3>
            <ActionForm action={actions.caps} resetOnSuccess={false} className="space-y-3">
              <input type="hidden" name="universityId" value={universityId} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Student cap">
                  <Input name="studentCap" inputMode="numeric" defaultValue={licence.studentCap} required />
                </Field>
                <Field label="Staff cap">
                  <Input name="staffCap" inputMode="numeric" defaultValue={licence.staffCap} required />
                </Field>
                <Field label="Charge before GST (₹)" hint="Empty: no invoice">
                  <Input name="charge" inputMode="decimal" placeholder="0" />
                </Field>
              </div>
              <Field label="Why">
                <Textarea name="note" rows={2} maxLength={300} required placeholder="Agreed on the renewal call: 40 more students until March" />
              </Field>
              <SubmitButton variant="secondary" pendingText="Saving…" icon="edit">
                Save caps
              </SubmitButton>
            </ActionForm>
          </section>
        )}

        <section className="space-y-3 border-t border-line pt-5">
          <h3 className="text-[14px] font-medium">Pack history</h3>
          {history.length === 0 ? (
            <p className="text-[13px] text-muted">No packs have been added or removed yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[13.5px]">
              {history.map((h) => (
                <li key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="text-ink">{describeSeatEvent(h)}</div>
                  <div className="text-[12px] text-muted">
                    {formatDateTime(h.at)}
                    {h.byName && ` · ${h.byName}`}
                    {typeof h.data.number === "string" && ` · invoice ${h.data.number}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {purchases.length > 0 && (
            <ul className="space-y-1.5 text-[12.5px] text-muted">
              {purchases.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {formatDate(todayIST(p.createdAt))}: {p.packsBought} {p.kind} pack{p.packsBought === 1 ? "" : "s"} of {p.seatsPerPack}
                    {p.packs < p.packsBought && `, ${p.packs} still on`}
                  </span>
                  {p.invoiceNumber && <Badge tone={p.invoiceStatus === "paid" ? "brand" : "neutral"}>{p.invoiceNumber}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}
