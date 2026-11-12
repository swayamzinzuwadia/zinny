"use client";

/**
 * The "Create invoice" and "Edit invoice" form (Finance → Invoices). Everything is
 * controlled, so the totals on the right follow every keystroke and nothing is lost when
 * the server sends back a validation error. The same pure `invoiceAmounts` the service
 * uses works out the totals here.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Card, CardTitle, Field, Input, Notice, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { createInvoiceAction, searchBillableAction, updateInvoiceAction } from "../invoice-actions";
import { inr, invoiceAmounts, parseRupees } from "../money";

type Person = { id: string; name: string; email: string; phone: string | null; role: string };
type Line = { key: number; description: string; quantity: string; price: string };

export type InvoiceFormProps = {
  uni: string;
  gstEnabled: boolean;
  /** GST state code of the institute; buyers in this state get CGST + SGST, others IGST. */
  sellerState: string;
  states: { code: string; name: string }[];
  today: string;
  defaultDueDate: string;
  categories: { id: string; name: string; defaultGstRateBp: number }[];
  /** Set to edit an unpaid invoice: who it's billed to, the category and the GST rate are fixed. */
  edit?: {
    invoiceId: string;
    number: string;
    category: string;
    buyerName: string;
    buyerEmail: string | null;
    placeOfSupply: string;
    gstApplied: boolean;
    gstRateBp: number;
    lines: { description: string; quantity: number; unitPricePaise: number }[];
    discountPaise: number;
    discountNote: string;
    issueDate: string;
    dueDate: string | null;
    notes: string;
  };
};

const ROLE_LABEL: Record<string, string> = { student: "Student", alumni: "Alumni", parent: "Parent", individual_learner: "Learner" };
const rupees = (paise: number) => (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100));
const pct = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, description: "", quantity: "1", price: "" });

export function InvoiceForm(p: InvoiceFormProps) {
  const e = p.edit;
  const gstOn = e ? e.gstApplied : p.gstEnabled;
  const base = `/${p.uni}/admin/finance/invoices`;

  const [categoryId, setCategoryId] = useState(p.categories[0]?.id ?? "course-fees");
  const [gstRate, setGstRate] = useState(String((e ? e.gstRateBp : (p.categories[0]?.defaultGstRateBp ?? 1800)) / 100));
  const [billTo, setBillTo] = useState<"person" | "other">("person");
  const [person, setPerson] = useState<Person | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [state, setState] = useState(e?.placeOfSupply ?? p.sellerState);
  const [lines, setLines] = useState<Line[]>(() =>
    e ? e.lines.map((l) => ({ key: nextKey++, description: l.description, quantity: String(l.quantity), price: rupees(l.unitPricePaise) })) : [blankLine()],
  );
  const [discount, setDiscount] = useState(e && e.discountPaise > 0 ? rupees(e.discountPaise) : "");
  const [discountNote, setDiscountNote] = useState(e?.discountNote ?? "");
  const [issueDate, setIssueDate] = useState(e?.issueDate ?? p.today);
  const [dueDate, setDueDate] = useState(e ? (e.dueDate ?? "") : p.defaultDueDate);
  const [notes, setNotes] = useState(e?.notes ?? "");

  // Search people of the institute as the admin types, a moment after they stop.
  const latest = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (person || q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++latest.current;
    const t = setTimeout(async () => {
      const found = await searchBillableAction(p.uni, q);
      if (mine !== latest.current) return;
      setResults(found);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, person, p.uni]);

  const parsed = useMemo(
    () =>
      lines.map((l) => {
        const price = l.price.trim() ? parseRupees(l.price) : 0;
        const quantity = Number(l.quantity || "1");
        const okQty = Number.isInteger(quantity) && quantity >= 1 && quantity <= 9999;
        return { quantity: okQty ? quantity : 0, unitPricePaise: price ?? 0, badPrice: price === null, badQty: !okQty };
      }),
    [lines],
  );
  const discountPaise = discount.trim() ? parseRupees(discount) : 0;
  const amounts = invoiceAmounts({
    lines: parsed,
    discountPaise: discountPaise ?? 0,
    gstRateBp: gstOn ? Math.round(Number(gstRate) * 100) : 0,
    intraState: state === p.sellerState,
  });
  const intra = state === p.sellerState;
  const discountTooBig = (discountPaise ?? 0) > 0 && (discountPaise ?? 0) >= amounts.subtotalPaise && amounts.subtotalPaise > 0;
  const stateName = p.states.find((s) => s.code === state)?.name ?? state;

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <ActionForm action={e ? updateInvoiceAction : createInvoiceAction} resetOnSuccess={false} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <input type="hidden" name="uni" value={p.uni} />
      {e && <input type="hidden" name="invoiceId" value={e.invoiceId} />}

      <div className="min-w-0 space-y-6">
        {e ? (
          <Card>
            <CardTitle hint="Fixed once an invoice is issued. To change them, cancel this invoice and create a new one.">Invoice {e.number}</CardTitle>
            <dl className="grid gap-4 text-[14px] sm:grid-cols-3">
              <div>
                <dt className="text-[13px] text-muted">Billed to</dt>
                <dd className="font-medium">{e.buyerName}</dd>
                {e.buyerEmail && <dd className="text-[13px] text-muted">{e.buyerEmail}</dd>}
              </div>
              <div>
                <dt className="text-[13px] text-muted">Category</dt>
                <dd>{e.category}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">GST</dt>
                <dd>{e.gstApplied ? `${pct(e.gstRateBp)}, ${intra ? "CGST + SGST" : "IGST"}` : "Not charged"}</dd>
              </div>
            </dl>
          </Card>
        ) : (
          <>
            <Card>
              <CardTitle hint="Categories group invoices in the list and its totals.">Category</CardTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category">
                  <Select
                    name="categoryId"
                    value={categoryId}
                    onChange={(ev) => {
                      setCategoryId(ev.target.value);
                      const c = p.categories.find((x) => x.id === ev.target.value);
                      if (c) setGstRate(String(c.defaultGstRateBp / 100));
                    }}
                  >
                    {p.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {gstOn ? (
                  <Field label="GST rate" hint="Starts from the category. Change it for this invoice if you need to.">
                    <Select name="gstRate" value={gstRate} onChange={(ev) => setGstRate(ev.target.value)}>
                      {[0, 5, 12, 18, 28].map((r) => (
                        <option key={r} value={r}>
                          {r === 0 ? "0% (exempt)" : `${r}%`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <div className="self-end rounded-xl bg-canvas px-3 py-2.5 text-[13px] text-muted ring-1 ring-line">
                    GST is turned off for this institute, so this invoice carries no tax.{" "}
                    <Link href={`/${p.uni}/admin/finance/sales/settings`} className="font-medium text-brand hover:underline">
                      Invoice settings
                    </Link>
                  </div>
                )}
              </div>
              <p className="mt-3 text-[13px] text-muted">
                Need another heading?{" "}
                <Link href={`${base}/categories`} className="font-medium text-brand hover:underline">
                  Manage categories
                </Link>
              </p>
            </Card>

            <Card>
              <CardTitle hint="People with an account see the invoice under Invoices and get a notification.">Bill to</CardTitle>
              <input type="hidden" name="billTo" value={billTo} />
              <div className="mb-4 inline-flex rounded-full border border-line bg-canvas p-1 text-[13px]" role="tablist" aria-label="Who the invoice is for">
                {(
                  [
                    ["person", "Someone at the institute"],
                    ["other", "Someone else"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={billTo === k}
                    onClick={() => setBillTo(k)}
                    className={cx("rounded-full px-3.5 py-1.5 font-medium transition-colors", billTo === k ? "bg-brand text-canvas" : "text-muted hover:text-ink")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {billTo === "person" ? (
                person ? (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3">
                    <input type="hidden" name="userId" value={person.id} />
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={person.name} />
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium">{person.name}</div>
                        <div className="truncate text-[13px] text-muted">
                          {person.email} · {ROLE_LABEL[person.role] ?? "Staff"}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={buttonClass("ghost", "sm")}
                      onClick={() => {
                        setPerson(null);
                        setQuery("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <Field label="Find a student or staff member" hint="Type at least 2 letters of a name or email.">
                      <Input type="search" value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Name or email" autoComplete="off" aria-label="Find a student or staff member" />
                    </Field>
                    {searching && <p className="mt-2 text-[13px] text-muted">Searching…</p>}
                    {results && !searching && results.length === 0 && (
                      <p className="mt-2 text-[13px] text-muted">
                        No one here matches “{query.trim()}”. Check the spelling, or choose “Someone else” to type their details in.
                      </p>
                    )}
                    {results && results.length > 0 && (
                      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="People found">
                        {results.map((r) => (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setPerson(r);
                                if (r.phone && !buyerPhone) setBuyerPhone(r.phone);
                              }}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-brand-soft"
                            >
                              <Avatar name={r.name} size={30} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] font-medium">{r.name}</span>
                                <span className="block truncate text-[13px] text-muted">{r.email}</span>
                              </span>
                              <span className="shrink-0 text-[12px] text-muted">{ROLE_LABEL[r.role] ?? "Staff"}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Name" hint="A person or an organisation.">
                      <Input name="buyerName" value={buyerName} onChange={(ev) => setBuyerName(ev.target.value)} maxLength={120} placeholder="Sunrise Coaching Centre" />
                    </Field>
                  </div>
                  <Field label="Email (optional)">
                    <Input name="buyerEmail" type="email" value={buyerEmail} onChange={(ev) => setBuyerEmail(ev.target.value)} placeholder="accounts@example.com" />
                  </Field>
                  <Field label="Phone (optional)">
                    <Input name="buyerPhone" type="tel" value={buyerPhone} onChange={(ev) => setBuyerPhone(ev.target.value)} maxLength={20} />
                  </Field>
                </div>
              )}

              <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Billing address (optional)">
                    <Textarea name="buyerAddress" value={buyerAddress} onChange={(ev) => setBuyerAddress(ev.target.value)} rows={2} maxLength={300} className="!min-h-[4.5rem]" />
                  </Field>
                </div>
                <Field label="State" hint={gstOn ? (intra ? "Same state as the institute: CGST + SGST." : "Another state: IGST.") : undefined}>
                  <Select name="placeOfSupply" value={state} onChange={(ev) => setState(ev.target.value)}>
                    {p.states.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {gstOn && (
                  <Field label="Buyer's GSTIN (optional)" hint="For a business that claims input credit.">
                    <Input name="buyerGstin" value={buyerGstin} onChange={(ev) => setBuyerGstin(ev.target.value.toUpperCase())} maxLength={15} className="font-mono" placeholder="27ABCDE1234F1Z5" />
                  </Field>
                )}
              </div>
            </Card>
          </>
        )}

        <Card>
          <CardTitle hint="One line for each thing you're charging for. Prices are in rupees, before GST.">Lines</CardTitle>
          <div className="space-y-3">
            <div className="hidden grid-cols-[minmax(0,1fr)_72px_130px_110px_32px] gap-3 text-[12px] font-medium text-muted sm:grid">
              <span>Description</span>
              <span>Qty</span>
              <span>Price (₹)</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {lines.map((l, i) => {
              const v = parsed[i];
              return (
                <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_32px] gap-3 sm:grid-cols-[minmax(0,1fr)_72px_130px_110px_32px] sm:items-center">
                  <Input
                    name="lineDescription"
                    value={l.description}
                    onChange={(ev) => setLine(l.key, { description: ev.target.value })}
                    placeholder={i === 0 ? "Semester 2 exam fee" : "Description"}
                    maxLength={120}
                    aria-label={`Line ${i + 1} description`}
                    className="col-span-1"
                  />
                  <button
                    type="button"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blankLine()]))}
                    aria-label={`Remove line ${i + 1}`}
                    title="Remove line"
                    className="row-span-1 flex h-10 w-8 items-center justify-center rounded-full text-muted hover:bg-danger-soft hover:text-danger sm:order-last"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                      <path d="M3 3l8 8M11 3l-8 8" />
                    </svg>
                  </button>
                  <div className="col-span-2 grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 sm:contents">
                    <Input
                      name="lineQuantity"
                      value={l.quantity}
                      onChange={(ev) => setLine(l.key, { quantity: ev.target.value.replace(/[^\d]/g, "") })}
                      inputMode="numeric"
                      aria-label={`Line ${i + 1} quantity`}
                      aria-invalid={v.badQty}
                      className={cx("tabular", v.badQty && "border-danger")}
                    />
                    <Input
                      name="linePrice"
                      value={l.price}
                      onChange={(ev) => setLine(l.key, { price: ev.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Line ${i + 1} price in rupees`}
                      aria-invalid={v.badPrice}
                      className={cx("tabular", v.badPrice && "border-danger")}
                    />
                    <span className="tabular min-w-20 text-right text-[14px]">{inr(v.quantity * v.unitPricePaise)}</span>
                  </div>
                  {(v.badPrice || v.badQty) && (
                    <p className="col-span-2 -mt-1 text-[12px] text-danger sm:col-span-5">
                      {v.badPrice ? "Enter the price in rupees, like 1500 or 1500.50." : "The quantity must be a whole number from 1 to 9,999."}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button type="button" className={buttonClass("secondary", "sm")} disabled={lines.length >= 12} onClick={() => setLines((ls) => [...ls, blankLine()])}>
              Add a line
            </button>
            {lines.length >= 12 && <span className="text-[12px] text-muted">An invoice holds up to 12 lines.</span>}
          </div>

          <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <Field label="Discount (₹, optional)">
              <Input name="discount" value={discount} onChange={(ev) => setDiscount(ev.target.value)} inputMode="decimal" placeholder="0" className={cx("tabular", (discountPaise === null || discountTooBig) && "border-danger")} />
            </Field>
            <Field label="Reason for the discount (optional)" hint="Printed under the discount, like “Sibling concession”.">
              <Input name="discountNote" value={discountNote} onChange={(ev) => setDiscountNote(ev.target.value)} maxLength={120} disabled={!discount.trim()} />
            </Field>
            {(discountPaise === null || discountTooBig) && (
              <p className="-mt-2 text-[12px] text-danger sm:col-span-2">
                {discountPaise === null ? "Enter the discount in rupees, like 500." : "The discount must be less than the lines add up to."}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Dates and notes</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invoice date" hint="Today or earlier. The invoice number follows its financial year.">
              <Input type="date" name="issueDate" value={issueDate} max={p.today} onChange={(ev) => setIssueDate(ev.target.value)} required />
            </Field>
            <Field label="Due date (optional)" hint="Unpaid after this day, the invoice shows as overdue.">
              <Input type="date" name="dueDate" value={dueDate} min={issueDate || undefined} onChange={(ev) => setDueDate(ev.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes (optional)" hint="Printed on the invoice: how to pay, bank details, what the fee covers.">
                <Textarea name="notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={3} maxLength={500} />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      <div className="xl:sticky xl:top-6">
        <Card>
          <CardTitle>Summary</CardTitle>
          <dl className="space-y-2 text-[14px]" aria-live="polite">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">
                {lines.filter((l) => l.description.trim() || l.price.trim()).length === 1 ? "1 line" : `${lines.filter((l) => l.description.trim() || l.price.trim()).length} lines`}
              </dt>
              <dd className="tabular">{inr(amounts.subtotalPaise)}</dd>
            </div>
            {amounts.discountPaise > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Discount</dt>
                <dd className="tabular">−{inr(Math.min(amounts.discountPaise, amounts.subtotalPaise))}</dd>
              </div>
            )}
            {gstOn && (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Taxable value</dt>
                  <dd className="tabular">{inr(amounts.taxablePaise)}</dd>
                </div>
                {intra ? (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">CGST {pct(Math.round(Number(gstRate) * 50))}</dt>
                      <dd className="tabular">{inr(amounts.cgstPaise)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">SGST {pct(Math.round(Number(gstRate) * 50))}</dt>
                      <dd className="tabular">{inr(amounts.sgstPaise)}</dd>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">IGST {pct(Math.round(Number(gstRate) * 100))}</dt>
                    <dd className="tabular">{inr(amounts.igstPaise)}</dd>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between gap-4 border-t border-line pt-3 text-[18px] font-semibold">
              <dt>Total</dt>
              <dd className="tabular" data-testid="invoice-total">
                {inr(amounts.totalPaise)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] text-muted">
            {gstOn
              ? intra
                ? `Buyer in ${stateName}, the institute's state: GST is split into CGST and SGST.`
                : `Buyer in ${stateName}, outside the institute's state: GST is charged as IGST.`
              : "No GST: the total is what the lines add up to, less any discount."}
          </p>
          {!e && (
            <div className="mt-4">
              <Notice tone="neutral">The invoice gets the next number in your series when you create it. Numbers are never reused, even if the invoice is cancelled.</Notice>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <SubmitButton pendingText={e ? "Saving…" : "Creating…"}>{e ? "Save changes" : "Create invoice"}</SubmitButton>
            <Link href={e ? `${base}/${e.invoiceId}` : base} className={buttonClass("ghost")}>
              Cancel
            </Link>
          </div>
        </Card>
      </div>
    </ActionForm>
  );
}
