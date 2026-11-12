"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, buttonClass } from "@/components/ui";
import { createInvoiceAction } from "../actions";
import { GST_RATES_BP } from "../lib/constants";
import type { InvoiceTerms } from "../services/billing";

export type InvoiceDraft = InvoiceTerms & { universityId: string; gstRateBp: number; issueDate: string; dueDate: string };

const rupeeText = (paise: number) => (paise > 0 ? (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)) : "");

/**
 * The new-invoice form. Picking the institute fills in its licence term, description and
 * price, leaving alone anything you've already typed there; "Fill in from licence" copies
 * them again on purpose. Nothing reloads, so the dates you typed stay.
 */
export function InvoiceForm({ institutes, terms, initial }: { institutes: { id: string; name: string }[]; terms: Record<string, InvoiceTerms>; initial: InvoiceDraft }) {
  const [universityId, setUniversityId] = useState(initial.universityId);
  const [description, setDescription] = useState(initial.description);
  const [periodStart, setPeriodStart] = useState(initial.periodStart);
  const [periodEnd, setPeriodEnd] = useState(initial.periodEnd);
  const [amount, setAmount] = useState(rupeeText(initial.listPricePaise));
  const [discount, setDiscount] = useState(rupeeText(initial.discountPaise));
  const [discountNote, setDiscountNote] = useState(initial.discountNote);
  const [typed, setTyped] = useState({ description: false, period: false, amount: false });
  const licence = universityId ? terms[universityId] : undefined;

  function fill(t: InvoiceTerms | undefined, overwrite: boolean) {
    if (!t) return;
    if (overwrite || !typed.description) setDescription(t.description);
    if (overwrite || !typed.period) {
      setPeriodStart(t.periodStart);
      setPeriodEnd(t.periodEnd);
    }
    if (overwrite || !typed.amount) {
      setAmount(rupeeText(t.listPricePaise));
      setDiscount(rupeeText(t.discountPaise));
      setDiscountNote(t.discountNote);
    }
  }

  return (
    <ActionForm action={createInvoiceAction} resetOnSuccess={false} className="space-y-4">
      <div className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Institute">
              <Select
                name="universityId"
                value={universityId}
                onChange={(e) => {
                  setUniversityId(e.target.value);
                  fill(terms[e.target.value], false);
                }}
                required
              >
                <option value="" disabled>
                  Pick an institute
                </option>
                {institutes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <button type="button" disabled={!licence} onClick={() => fill(licence, true)} className={`${buttonClass("secondary")} whitespace-nowrap`}>
            Fill in from licence
          </button>
        </div>
        {universityId && !licence && <p className="mt-2 text-[12.5px] text-muted">This institute has no licence yet, so fill in the description and period yourself.</p>}
      </div>
      <Field label="Description">
        <Input
          name="description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setTyped((t) => ({ ...t, description: true }));
          }}
          placeholder="Zinny Standard licence"
          required
          maxLength={300}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period from">
          <Input
            name="periodStart"
            type="date"
            value={periodStart}
            onChange={(e) => {
              setPeriodStart(e.target.value);
              setTyped((t) => ({ ...t, period: true }));
            }}
            required
          />
        </Field>
        <Field label="Period to">
          <Input
            name="periodEnd"
            type="date"
            value={periodEnd}
            min={periodStart || undefined}
            onChange={(e) => {
              setPeriodEnd(e.target.value);
              setTyped((t) => ({ ...t, period: true }));
            }}
            required
          />
        </Field>
        <Field label="Amount before GST (₹)" hint="The list price, before any discount">
          <Input
            name="amount"
            inputMode="decimal"
            placeholder="45000"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setTyped((t) => ({ ...t, amount: true }));
            }}
            required
          />
        </Field>
        <Field label="Discount (₹)" hint="Leave empty for none">
          <Input
            name="discount"
            inputMode="decimal"
            placeholder="0"
            value={discount}
            onChange={(e) => {
              setDiscount(e.target.value);
              setTyped((t) => ({ ...t, amount: true }));
            }}
          />
        </Field>
        {discount.trim() !== "" && discount.trim() !== "0" && (
          <div className="col-span-2">
            <Field label="Why the discount">
              <Input name="discountNote" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} required maxLength={300} />
            </Field>
          </div>
        )}
        <Field label="GST">
          <Select name="gst" defaultValue={String(initial.gstRateBp / 100)}>
            {GST_RATES_BP.map((g) => (
              <option key={g} value={g / 100}>
                {g / 100}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice date">
          <Input name="issueDate" type="date" defaultValue={initial.issueDate} required />
        </Field>
        <Field label="Due date">
          <Input name="dueDate" type="date" defaultValue={initial.dueDate} required />
        </Field>
      </div>
      <SubmitButton pendingText="Issuing…">Issue invoice</SubmitButton>
    </ActionForm>
  );
}
