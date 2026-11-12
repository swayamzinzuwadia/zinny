"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { reviseInvoiceAction } from "../actions";
import { chargeFor } from "../lib/charge";
import { formatINR, parseRupees } from "../lib/format";

export type RevisableInvoice = {
  id: string;
  number: string;
  description: string;
  periodStart: string;
  periodEnd: string;
  listPricePaise: number;
  discountPaise: number;
  discountNote: string | null;
  gstRateBp: number;
  issueDate: string;
  dueDate: string;
  intraState: boolean;
};

const rupeeText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

/**
 * Revises an unpaid invoice: amount, discount, description, period and dates. The new
 * GST and total show as you type; the number stays the same.
 */
export function ReviseInvoiceForm({ invoice: i }: { invoice: RevisableInvoice }) {
  const [amount, setAmount] = useState(rupeeText(i.listPricePaise));
  const [discount, setDiscount] = useState(i.discountPaise ? rupeeText(i.discountPaise) : "");
  const [issueDate, setIssueDate] = useState(i.issueDate);
  const list = amount.trim() ? parseRupees(amount) : Number.NaN;
  const off = discount.trim() ? parseRupees(discount) : 0;
  const sum = Number.isFinite(list) && Number.isFinite(off) && list > 0 && off < list ? chargeFor(list, off, i.gstRateBp, i.intraState) : null;

  return (
    <ActionForm action={reviseInvoiceAction} resetOnSuccess={false} className="space-y-3" confirm={`Revise invoice ${i.number}? The change is logged with your name.`}>
      <input type="hidden" name="invoiceId" value={i.id} />
      <Field label="Description">
        <Input name="description" defaultValue={i.description} required minLength={3} maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount before GST (₹)">
          <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Discount (₹)">
          <Input name="discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <Field label="Why the discount" hint="Needed when there is a discount">
        <Input name="discountNote" defaultValue={i.discountNote ?? ""} maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period from">
          <Input name="periodStart" type="date" defaultValue={i.periodStart} required />
        </Field>
        <Field label="Period to">
          <Input name="periodEnd" type="date" defaultValue={i.periodEnd} required />
        </Field>
        <Field label="Invoice date">
          <Input name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
        </Field>
        <Field label="Due date">
          <Input name="dueDate" type="date" defaultValue={i.dueDate} min={issueDate || undefined} required />
        </Field>
      </div>
      <p className="rounded-xl bg-canvas px-3 py-2 text-[13px] text-muted" aria-live="polite">
        {sum ? (
          <>
            Net {formatINR(sum.basePaise)} + GST {formatINR(sum.gstPaise)} = <span className="font-semibold text-ink">{formatINR(sum.totalPaise)}</span>
          </>
        ) : (
          "Enter an amount in rupees, with a discount smaller than it."
        )}
      </p>
      <SubmitButton pendingText="Saving…">Save revision</SubmitButton>
    </ActionForm>
  );
}
