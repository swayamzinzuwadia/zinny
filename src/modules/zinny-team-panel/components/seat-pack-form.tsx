"use client";
/**
 * Adding seat packs, with the price worked out as you type: the days left in the term, the
 * amount before GST, the GST and the total. The sums are lib/seat-packs.ts and lib/charge.ts,
 * the same ones the service charges, and the total is sent along so a price that changed in
 * between is caught before anything is bought.
 */
import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { chargeFor } from "../lib/charge";
import { formatDate, formatINR } from "../lib/format";
import { MAX_PACKS_PER_PURCHASE, PACK_KINDS, quotePacks, type PackKind, type PackPricing } from "../lib/seat-packs";

export type SeatPackFormProps = {
  action: FormAction;
  pricing: PackPricing;
  term: { startDate: string; endDate: string };
  today: string;
  gstRateBp: number;
  intraState: boolean;
  /** Extra hidden fields (the university, the institute's slug). */
  hidden?: Record<string, string>;
  /** "zinny": the team adds packs, may skip the invoice and writes a note. */
  mode: "institute" | "zinny";
};

const kindLabel = (kind: PackKind, size: number) => (kind === "student" ? `Student packs, ${size} students each` : `Staff packs, ${size} staff each`);

export function SeatPackForm({ action, pricing, term, today, gstRateBp, intraState, hidden = {}, mode }: SeatPackFormProps) {
  const [kind, setKind] = useState<PackKind>("student");
  const [raw, setRaw] = useState("1");
  const [charge, setCharge] = useState(true);
  const packs = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 0;
  const valid = packs >= 1 && packs <= MAX_PACKS_PER_PURCHASE;
  const terms = pricing[kind];
  const quote = quotePacks({ packs: valid ? packs : 0, terms, ...term, today });
  const sum = chargeFor(quote.amountPaise, 0, gstRateBp, intraState);
  const billed = mode === "institute" || charge;
  const people = kind === "student" ? "students" : "staff";

  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="expectedTotalPaise" value={billed ? sum.totalPaise : ""} />
      <div className="grid gap-4 sm:grid-cols-[1.6fr_1fr]">
        <Field label="Pack">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PackKind)}>
            {PACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k, pricing[k].size)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How many packs">
          <Input name="packs" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} required />
        </Field>
      </div>

      {mode === "zinny" && (
        <>
          <label className="flex items-start gap-2.5 text-[14px]">
            <input type="checkbox" name="charge" checked={charge} onChange={(e) => setCharge(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0b5e4c]" />
            <span>
              <span className="font-medium">Invoice these packs</span>
              <span className="block text-[13px] text-muted">Off: the packs are free, say as part of a deal. Write why below.</span>
            </span>
          </label>
          <Field label={charge ? "Note (optional)" : "Why they are free"}>
            <Textarea name="note" rows={2} maxLength={300} required={!charge} placeholder={charge ? "Asked for on the renewal call" : "Agreed at signing: one staff pack free for the first year"} />
          </Field>
        </>
      )}

      <div className="rounded-2xl border border-line bg-canvas/60 p-4 text-[14px]" aria-live="polite">
        {!valid ? (
          <p className="text-muted">Enter a whole number of packs, from 1 to {MAX_PACKS_PER_PURCHASE}.</p>
        ) : (
          <dl className="space-y-1.5">
            <Row label={`Adds ${quote.seats.toLocaleString("en-IN")} ${people}`}>
              {formatINR(terms.yearPricePaise)} a pack a year{quote.termMonths !== 12 && `, ${formatINR(quote.termPricePaise)} for this ${quote.termMonths}-month term`}
            </Row>
            <Row label={`For ${quote.daysLeft} of ${quote.termDays} days`}>
              {formatDate(quote.periodStart, { year: false })} to {formatDate(quote.periodEnd)}
            </Row>
            {billed ? (
              <>
                <Row label="Before GST">{formatINR(sum.basePaise)}</Row>
                {intraState ? (
                  <>
                    <Row label={`CGST ${gstRateBp / 200}%`}>{formatINR(sum.cgstPaise)}</Row>
                    <Row label={`SGST ${gstRateBp / 200}%`}>{formatINR(sum.sgstPaise)}</Row>
                  </>
                ) : (
                  <Row label={`IGST ${gstRateBp / 100}%`}>{formatINR(sum.igstPaise)}</Row>
                )}
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-medium text-ink">
                  <dt>{mode === "institute" ? "You pay" : "Invoice total"}</dt>
                  <dd className="tabular text-[16px]">{formatINR(sum.totalPaise)}</dd>
                </div>
              </>
            ) : (
              <Row label="Charge">Not invoiced</Row>
            )}
          </dl>
        )}
      </div>

      <SubmitButton pendingText={mode === "institute" ? "Buying…" : "Adding…"} icon={mode === "institute" ? "money" : "add"}>
        {mode === "institute" ? (valid && billed ? `Buy ${packs === 1 ? "1 pack" : `${packs} packs`} for ${formatINR(sum.totalPaise)}` : "Buy packs") : `Add ${valid && packs > 1 ? `${packs} packs` : "pack"}`}
      </SubmitButton>
    </ActionForm>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular text-right">{children}</dd>
    </div>
  );
}
