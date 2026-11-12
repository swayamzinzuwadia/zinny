import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { formatDate } from "@/server/lib/dates";
import { createBatchListingAction } from "../actions";
import type { BatchListingInfo, BatchListingState, ListableBatch } from "../listings";
export { KIND_LABEL } from "./price";

/** Title, description, price and compare-at price: the same fields for every kind of listing. */
export function ListingFieldsInputs({
  title,
  description,
  pricePaise,
  compareAtPaise,
  titlePlaceholder,
}: {
  title?: string;
  description?: string;
  pricePaise?: number;
  compareAtPaise?: number | null;
  titlePlaceholder?: string;
}) {
  return (
    <>
      <Field label="Title on the marketplace">
        <Input name="title" required minLength={3} maxLength={120} defaultValue={title} placeholder={titlePlaceholder} />
      </Field>
      <Field label="Description" hint="What buyers will learn, and who it's for.">
        <Textarea name="description" maxLength={2000} defaultValue={description} />
      </Field>
      <PriceInputs pricePaise={pricePaise} compareAtPaise={compareAtPaise} />
    </>
  );
}

function PriceInputs({ pricePaise, compareAtPaise }: { pricePaise?: number; compareAtPaise?: number | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Price before GST (₹)" hint="If your institute charges GST, it is added at the course's rate.">
        <Input name="price" required inputMode="decimal" placeholder="1499" defaultValue={pricePaise ? String(pricePaise / 100) : undefined} />
      </Field>
      <Field label="Compare-at price (₹)" hint="Optional. The usual price, shown struck through.">
        <Input name="compareAt" inputMode="decimal" placeholder="2999" defaultValue={compareAtPaise ? String(compareAtPaise / 100) : undefined} />
      </Field>
    </div>
  );
}

/** The late-joining tick, for a live batch. `hasLateJoin` tells the action the box was on the form at all. */
export function LateJoinInput({ checked = false }: { checked?: boolean }) {
  return (
    <label className="flex items-start gap-3 text-[14px]">
      <input type="hidden" name="hasLateJoin" value="1" />
      <input type="checkbox" name="lateJoin" defaultChecked={checked} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span>
        <span className="font-medium">Let people join after the batch has started</span>
        <span className="block text-[13px] text-muted">Left off, the listing leaves the marketplace on the batch&apos;s first day. Either way it leaves on the last day.</span>
      </span>
    </label>
  );
}

const STATE: Record<BatchListingState, { label: string; tone: "brand" | "neutral" | "gold" }> = {
  on_sale: { label: "On sale", tone: "brand" },
  full: { label: "Batch full", tone: "gold" },
  paused: { label: "Paused", tone: "neutral" },
  ended: { label: "Batch ended", tone: "neutral" },
  closed: { label: "Batch closed", tone: "neutral" },
  started: { label: "Joining closed", tone: "neutral" },
  needs_approval: { label: "Needs approval off", tone: "gold" },
};

/** Why a live batch's listing isn't being offered though nobody paused it, for the admin. */
export const STATE_NOTE: Partial<Record<BatchListingState, string>> = {
  full: "Every seat is taken, so the marketplace shows it as full. It goes back on sale when a seat frees up or you raise the seat limit.",
  ended: "The batch has passed its last day, so it left the marketplace on its own.",
  closed: "The batch is closed or archived, so it left the marketplace on its own. Reopen the batch to offer it again.",
  started: "The batch has started and late joining is off, so it left the marketplace. Tick late joining to offer it again.",
  needs_approval: "Faculty now accept each student in this batch, so it can't be bought. Switch that off on the batch to offer it again.",
};

export function BatchStateBadge({ state }: { state: BatchListingState }) {
  return <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>;
}

/** "Weekday morning · 4 Nov 2026 to 31 Jan 2027 · Mon to Fri, 9 am to 11 am". */
export function batchLine(b: Pick<BatchListingInfo, "batchName" | "startDate" | "endDate" | "timings">) {
  return `${b.batchName} · ${formatDate(b.startDate)} to ${formatDate(b.endDate)} · ${b.timings}`;
}

/** "3 sold here · 12 of 20 seats taken": marketplace seats, then the whole batch. */
export function seatsSoldLine(buyers: number, b: Pick<BatchListingInfo, "seatsTaken" | "seatLimit">) {
  return `${buyers} sold on the marketplace · ${b.seatsTaken} of ${b.seatLimit} seats taken`;
}

/**
 * "List a live batch": choose one of the batches that can be sold, set its marketplace price
 * and say whether people may join late. Batches that can't be listed are shown with the reason.
 */
export function ListBatchForm({ uni, batches, showCourse = true }: { uni: string; batches: ListableBatch[]; showCourse?: boolean }) {
  const ready = batches.filter((b) => !b.problem);
  const blocked = batches.filter((b) => b.problem);
  const name = (b: ListableBatch) => (showCourse ? `${b.courseTitle}: ${b.name}` : b.name);
  return (
    <div className="space-y-5">
      {ready.length > 0 ? (
        <ActionForm action={createBatchListingAction} className="space-y-4">
          <input type="hidden" name="uni" value={uni} />
          <Field label="Batch to sell seats in" hint="Buyers join this very batch, within its seat limit. Your own students keep joining it as before.">
            <Select name="batchId" required defaultValue={ready.length === 1 ? ready[0].id : ""}>
              <option value="" disabled>
                Choose a batch
              </option>
              {ready.map((b) => (
                <option key={b.id} value={b.id}>
                  {name(b)} · starts {formatDate(b.startDate)} · {b.seatLimit - b.seatsTaken} of {b.seatLimit} seats free
                </option>
              ))}
            </Select>
          </Field>
          <PriceInputs />
          <Field label="Description" hint="Who this batch is for and what they'll be able to do by the end. The course's own description shows too.">
            <Textarea name="description" maxLength={2000} />
          </Field>
          <LateJoinInput />
          <SubmitButton pendingText="Listing…">List this batch</SubmitButton>
        </ActionForm>
      ) : (
        <p className="text-[14px] text-muted">
          {blocked.length > 0 ? "None of your batches can be listed right now. The reasons are below." : "There are no open batches left to list. Every open batch is already on the marketplace, or none has been created yet."}
        </p>
      )}
      {blocked.length > 0 && (
        <div>
          <h4 className="mb-2 text-[13px] font-medium text-muted">Can&apos;t be listed yet</h4>
          <ul className="space-y-2">
            {blocked.map((b) => (
              <li key={b.id}>
                <Notice tone="neutral">
                  <Link href={`/${uni}/admin/products/batches/${b.id}`} className="font-medium text-ink hover:text-brand">
                    {name(b)}
                  </Link>
                  <span className="block">{b.problem}</span>
                </Notice>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
