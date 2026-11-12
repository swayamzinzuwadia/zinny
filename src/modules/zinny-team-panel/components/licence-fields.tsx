"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { chargeFor } from "../lib/charge";
import { LICENSABLE_MODULES } from "../lib/constants";
import { addDays, formatDate, formatINR, isDate, parseRupees } from "../lib/format";
import { termEnd, type ChargeDefaults, type LicenceValues } from "../lib/licence";
import type { PlanOption } from "../services/plans";

export type { ChargeDefaults, LicenceValues };

const rupeeText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
const endFor = termEnd;

/**
 * The licence fields: plan, caps, modules, term, and what the institute is charged.
 * Picking a plan fills in its caps, modules, term and fixed price until you change those
 * yourself; every value can still be edited. The charge is worked out as you type, the
 * same way the invoice will be.
 *
 * `existing` is a licence that is already in place: saving a small change to it (a cap, a
 * note) doesn't bill anything, so "Don't create an invoice" starts ticked and clears
 * itself when the plan or the term changes.
 */
export function LicenceFields({
  plans,
  initial,
  charge,
  existing = false,
  disabled,
}: {
  plans: PlanOption[];
  initial: LicenceValues;
  charge: ChargeDefaults;
  existing?: boolean;
  disabled?: boolean;
}) {
  const planOf = (key: string) => plans.find((p) => p.key === key);
  const [plan, setPlan] = useState(initial.plan);
  const [studentCap, setStudentCap] = useState(String(initial.studentCap));
  const [staffCap, setStaffCap] = useState(String(initial.staffCap));
  const [modules, setModules] = useState<string[]>(initial.modules);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [price, setPrice] = useState(rupeeText(initial.pricePaise));
  const [discount, setDiscount] = useState(initial.discountPaise ? rupeeText(initial.discountPaise) : "");
  const [discountNote, setDiscountNote] = useState(initial.discountNote);
  const [invoiceDate, setInvoiceDate] = useState(charge.invoiceDate);
  const [dueDate, setDueDate] = useState(addDays(charge.invoiceDate, charge.paymentDays));
  const [noInvoice, setNoInvoice] = useState(existing);
  const [touched, setTouched] = useState({ caps: false, end: false, modules: false, price: false, due: false, noInvoice: false });
  const touch = (k: keyof typeof touched) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  const current = planOf(plan);
  const months = current?.billingMonths ?? 12;
  /** Something that gets billed changed: stop skipping the invoice, unless they chose to. */
  const billable = () => {
    if (!touched.noInvoice) setNoInvoice(false);
  };

  function pickPlan(key: string) {
    setPlan(key);
    const p = planOf(key);
    if (!p) return;
    if (!touched.caps) {
      setStudentCap(String(p.studentCap));
      setStaffCap(String(p.staffCap));
    }
    if (!touched.modules) setModules(p.modules);
    if (!touched.end && startDate) setEndDate(endFor(startDate, p.billingMonths));
    if (!touched.price) setPrice(rupeeText(p.pricePaise));
    billable();
  }

  /** The next term straight after this one, at the plan's price today. */
  function renew() {
    const start = isDate(initial.endDate) ? addDays(initial.endDate, 1) : charge.invoiceDate;
    setStartDate(start);
    setEndDate(endFor(start, months));
    if (current) setPrice(rupeeText(current.pricePaise));
    setDiscount("");
    setDiscountNote("");
    setNoInvoice(false);
  }

  const pricePaise = price.trim() ? parseRupees(price) : 0;
  const discountPaise = discount.trim() ? parseRupees(discount) : 0;
  const valid = Number.isFinite(pricePaise) && Number.isFinite(discountPaise) && discountPaise <= pricePaise;
  const sum = valid ? chargeFor(pricePaise, discountPaise, current?.gstRateBp ?? 1800, charge.intraState) : null;
  const free = !!sum && sum.basePaise === 0;
  const willInvoice = !noInvoice && !!sum && !free;
  const rate = (current?.gstRateBp ?? 1800) / 100;

  return (
    <fieldset disabled={disabled} className="space-y-5">
      <div className="space-y-4">
        <Field label="Plan" hint={current ? `${current.description ? `${current.description} ` : ""}${formatINR(current.pricePaise)} before GST for ${current.billingMonths} month${current.billingMonths === 1 ? "" : "s"}.` : undefined}>
          <Select name="plan" value={plan} onChange={(e) => pickPlan(e.target.value)} required>
            {!current && <option value={plan}>{plan || "Pick a plan"}</option>}
            {plans.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
                {p.archived ? " (archived)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Student cap" hint="People with an active student role">
            <Input
              name="studentCap"
              inputMode="numeric"
              value={studentCap}
              onChange={(e) => {
                setStudentCap(e.target.value);
                touch("caps");
              }}
              required
            />
          </Field>
          <Field label="Staff cap" hint="Admin and teaching roles">
            <Input
              name="staffCap"
              inputMode="numeric"
              value={staffCap}
              onChange={(e) => {
                setStaffCap(e.target.value);
                touch("caps");
              }}
              required
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts on">
            <Input
              name="startDate"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (!touched.end && e.target.value) setEndDate(endFor(e.target.value, months));
                billable();
              }}
              required
            />
          </Field>
          <Field label="Ends on">
            <Input
              name="endDate"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                touch("end");
                billable();
              }}
              required
            />
          </Field>
        </div>
        {existing && (
          <button type="button" onClick={renew} className={buttonClass("secondary", "sm")}>
            Renew for another {months === 12 ? "year" : `${months} month${months === 1 ? "" : "s"}`}
          </button>
        )}
        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Modules switched on</span>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {LICENSABLE_MODULES.map((m) => (
              <label key={m.id} className="flex items-center gap-2 rounded-xl px-2 py-1 text-[14px] hover:bg-canvas">
                <input
                  type="checkbox"
                  name="modules"
                  value={m.id}
                  checked={modules.includes(m.id)}
                  onChange={(e) => {
                    setModules((list) => (e.target.checked ? [...list, m.id] : list.filter((id) => id !== m.id)));
                    touch("modules");
                  }}
                  className="h-4 w-4 accent-[#0b5e4c]"
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-canvas/60 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[15px] font-medium">Charge</span>
          <span className="text-[12.5px] text-muted">The plan sets the price. Change it only for what was agreed.</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="List price before GST (₹)">
            <Input
              name="price"
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                touch("price");
              }}
              required
            />
          </Field>
          <Field label="Discount (₹)" hint="Leave empty for none">
            <Input name="discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </Field>
        </div>
        {discountPaise > 0 && (
          <div className="mt-3">
            <Field label="Why the discount" hint="Shown on the invoice page and kept in the log">
              <Input name="discountNote" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="Founding institute offer, agreed with the principal" required maxLength={300} />
            </Field>
          </div>
        )}

        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[14px]" aria-live="polite">
          {sum ? (
            <>
              <Row label="List price" value={formatINR(sum.listPricePaise)} />
              {sum.discountPaise > 0 && <Row label="Discount" value={`− ${formatINR(sum.discountPaise)}`} />}
              <Row label="Net" value={formatINR(sum.basePaise)} />
              <Row label={charge.intraState ? `GST ${rate}% (CGST + SGST)` : `GST ${rate}% (IGST)`} value={formatINR(sum.gstPaise)} />
              <Row label="Total to invoice" value={formatINR(sum.totalPaise)} strong />
            </>
          ) : (
            <p className="text-danger">{Number.isFinite(pricePaise) && Number.isFinite(discountPaise) ? "The discount can't be more than the price." : "Enter amounts in rupees, like 720000 or 7,20,000."}</p>
          )}
        </dl>

        <div className={cx("mt-4 grid grid-cols-2 gap-3", !willInvoice && "opacity-50")}>
          <Field label="Invoice date">
            <Input
              name="invoiceDate"
              type="date"
              value={invoiceDate}
              onChange={(e) => {
                setInvoiceDate(e.target.value);
                if (!touched.due && isDate(e.target.value)) setDueDate(addDays(e.target.value, charge.paymentDays));
              }}
              required={willInvoice}
            />
          </Field>
          <Field label="Due date">
            <Input
              name="invoiceDueDate"
              type="date"
              value={dueDate}
              min={invoiceDate || undefined}
              onChange={(e) => {
                setDueDate(e.target.value);
                touch("due");
              }}
              required={willInvoice}
            />
          </Field>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-[14px]">
          <input
            type="checkbox"
            name="noInvoice"
            checked={noInvoice}
            onChange={(e) => {
              setNoInvoice(e.target.checked);
              touch("noInvoice");
            }}
            className="mt-1 h-4 w-4 accent-[#0b5e4c]"
          />
          <span>
            <span className="font-medium">Don&apos;t create an invoice</span>
            <span className="block text-[13px] text-muted">For free pilots, corrections, and changes that aren&apos;t billed. The price is still saved on the licence.</span>
          </span>
        </label>
        <p className="mt-3 text-[13px] text-muted">
          {willInvoice
            ? `Saving raises an invoice for ${formatINR(sum!.totalPaise)}${isDate(dueDate) ? `, due ${formatDate(dueDate)}` : ""}.`
            : free && !noInvoice
              ? "Nothing to charge, so no invoice is created."
              : "Saving doesn't create an invoice."}
        </p>
      </div>

      <Field label="Notes" hint="Optional. What was agreed, who signed.">
        <Textarea name="notes" defaultValue={initial.notes} maxLength={2000} />
      </Field>
    </fieldset>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4", strong && "border-t border-line pt-2 font-semibold")}>
      <dt className={strong ? undefined : "text-muted"}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
