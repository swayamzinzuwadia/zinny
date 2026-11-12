import Link from "next/link";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Select, Stat, Table, Td, buttonClass, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { InvoiceStatusBadge } from "@/modules/payments/components/status-badge";
import { REGISTER_STATUSES, REGISTER_STATUS_LABEL, invoiceRegister, parseRegisterFilters, type RegisterFilters } from "@/modules/payments/invoice-register";
import { inr } from "@/modules/payments/money";
import { invoiceDate } from "@/modules/payments/pdf/invoice-pdf";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function query(f: RegisterFilters, extra: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  if (f.category) q.set("category", f.category);
  if (f.status) q.set("status", f.status);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.q) q.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function InvoicesPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin/finance/invoices`;

  if (!can(actor, "finance.view", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Invoices" />
        <Empty title="You don't have access to Invoices">Your role doesn&apos;t include Finance. Ask an Institute Admin if you need it.</Empty>
      </>
    );
  }

  const f = parseRegisterFilters(sp);
  const data = await invoiceRegister(actor, f);
  const t = data.totals;
  const filtered = Boolean(f.category || f.status || f.from || f.to || f.q);
  const live = data.categories.filter((c) => !c.archived);
  const archived = data.categories.filter((c) => c.archived);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Every invoice in one place: course and marketplace orders, and the invoices you raise yourself for exam fees, hostel, workshops and more."
        actions={
          <>
            <Link href={`${base}/categories`} className={buttonClass("secondary", "sm")}>
              Categories
            </Link>
            {/* Plain link: it downloads a file. */}
            <a href={`${base}/export${query(f)}`} className={buttonClass("secondary", "sm")}>
              Export CSV
            </a>
            {data.can.manage && (
              <Link href={`${base}/new`} className={buttonClass("primary", "sm")}>
                Create invoice
              </Link>
            )}
          </>
        }
      />

      <form method="get" className="mb-6 grid gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Category">
          <Select name="category" defaultValue={f.category ?? ""}>
            <option value="">All categories</option>
            {live.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {archived.length > 0 && (
              <optgroup label="Archived">
                {archived.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={f.status ?? ""}>
            <option value="">All statuses</option>
            {REGISTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REGISTER_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoiced from">
          <Input type="date" name="from" defaultValue={f.from ?? ""} />
        </Field>
        <Field label="Invoiced to">
          <Input type="date" name="to" defaultValue={f.to ?? ""} />
        </Field>
        <Field label="Search">
          <Input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Number, name or email" />
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className={buttonClass("primary")}>
            Apply filters
          </button>
          {filtered && (
            <Link href={base} className={buttonClass("ghost")}>
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Billed" value={inr(t.billedPaise)} hint={`${t.count - t.cancelled} ${t.count - t.cancelled === 1 ? "invoice" : "invoices"}${t.cancelled ? `, ${t.cancelled} cancelled left out` : ""}`} />
        <Stat label="Collected" value={inr(t.collectedPaise)} hint="Invoices marked paid" />
        <Stat label="Outstanding" value={inr(t.outstandingPaise)} hint={t.unpaid === 0 ? "Nothing waiting" : `${t.unpaid} unpaid ${t.unpaid === 1 ? "invoice" : "invoices"}`} />
        <div className={cx("rounded-[22px] border px-5 py-4", t.overdue > 0 ? "border-gold/60 bg-gold-soft" : "border-line bg-surface")}>
          <div className={cx("text-[13px]", t.overdue > 0 ? "text-gold-strong" : "text-muted")}>Overdue</div>
          <div className="tabular mt-1 text-[30px] font-semibold leading-none">{inr(t.overduePaise)}</div>
          <div className={cx("mt-1.5 text-[12px]", t.overdue > 0 ? "text-gold-strong" : "text-muted")}>
            {t.overdue === 0 ? "Nothing past its due date" : `${t.overdue} past ${t.overdue === 1 ? "its" : "their"} due date`}
          </div>
        </div>
      </div>

      {t.overdue > 0 && f.status !== "overdue" && (
        <div className="mb-6">
          <Notice tone="gold">
            {t.overdue === 1 ? "One invoice is" : `${t.overdue} invoices are`} unpaid past the due date, {inr(t.overduePaise)} in all.{" "}
            <Link href={`${base}${query({ ...f, status: "overdue", page: undefined })}`} className="font-medium underline underline-offset-2">
              Show {t.overdue === 1 ? "it" : "them"}
            </Link>
          </Notice>
        </div>
      )}

      <Card className="mb-6 p-5">
          <CardTitle hint={filtered ? "For these filters" : undefined}>By category</CardTitle>
          {data.byCategory.length === 0 ? (
            <p className="text-[14px] text-muted">Nothing to add up yet.</p>
          ) : (
            <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              {data.byCategory.map((c) => {
                const share = t.billedPaise > 0 ? Math.round((c.billedPaise / t.billedPaise) * 100) : 0;
                return (
                  <li key={c.id} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`${base}${query({ ...f, category: c.id, page: undefined })}`} className="min-w-0 truncate text-[14px] font-medium hover:text-brand">
                        {c.name}
                      </Link>
                      <span className="tabular shrink-0 text-[14px] font-medium">{inr(c.billedPaise)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas ring-1 ring-line" aria-hidden>
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(share, c.billedPaise > 0 ? 2 : 0)}%` }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
                      <span>
                        {c.count} {c.count === 1 ? "invoice" : "invoices"}
                      </span>
                      <span className="tabular">{inr(c.collectedPaise)} collected</span>
                      {c.outstandingPaise > 0 && <span className="tabular">{inr(c.outstandingPaise)} outstanding</span>}
                      {c.archived && <Badge>Archived</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!data.gstEnabled && (
            <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">
              GST is turned off, so new invoices carry no tax.{" "}
              <Link href={`/${uni}/admin/finance/sales/settings`} className="font-medium text-brand hover:underline">
                Invoice settings
              </Link>
            </p>
          )}
      </Card>

      <div>
        <div className="min-w-0">
          {data.rows.length === 0 ? (
            <Empty title={filtered ? "No invoices match these filters" : "No invoices yet"}>
              {filtered
                ? "Change or clear the filters to see more."
                : data.can.manage
                  ? "Invoices for paid orders appear here on their own. Use Create invoice to bill anything else."
                  : "Invoices for paid orders appear here on their own."}
            </Empty>
          ) : (
            <>
              <Table head={["Invoice", "Billed to", "Category", "Dates", <span key="a" className="block text-right">Amount</span>, "Status"]}>
                {data.rows.map((r) => {
                  const href = r.source === "manual" ? `${base}/${r.id}` : `/${uni}/admin/finance/sales?order=${r.orderId}`;
                  return (
                    <tr key={`${r.source}:${r.id}`} className={cx("hover:bg-canvas/60", r.status === "cancelled" && "text-muted")}>
                      <Td>
                        <Link href={href} className="font-mono text-[13px] font-medium hover:text-brand">
                          {r.number}
                        </Link>
                        <div className="mt-0.5 max-w-[240px] truncate text-[13px] text-muted" title={r.description}>
                          {r.description}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-medium">{r.buyerName}</div>
                        {r.buyerEmail && <div className="text-[13px] text-muted">{r.buyerEmail}</div>}
                      </Td>
                      <Td>
                        <div className="whitespace-nowrap">{r.category}</div>
                        <div className="text-[12.5px] text-muted">{r.source === "order" ? "Order" : "Raised here"}</div>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <div>{invoiceDate(r.issueDate)}</div>
                        {r.dueDate && r.status === "unpaid" && <div className={cx("text-[12.5px]", r.overdue ? "font-medium text-gold-strong" : "text-muted")}>Due {invoiceDate(r.dueDate)}</div>}
                        {r.status === "paid" && r.paidOn && r.source === "manual" && <div className="text-[12.5px] text-muted">Paid {invoiceDate(r.paidOn)}</div>}
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        <span className={cx("tabular font-medium", r.status === "cancelled" && "line-through")}>{inr(r.totalPaise)}</span>
                        {r.gstPaise > 0 && <div className="tabular text-[12.5px] text-muted">incl. {inr(r.gstPaise)} GST</div>}
                        {r.refundedPaise > 0 && <div className="tabular text-[12.5px] text-muted">−{inr(r.refundedPaise)} refunded</div>}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <InvoiceStatusBadge status={r.status} overdue={r.overdue} />
                        <div className="mt-1">
                          {/* Plain link: it opens a file. */}
                          <a href={`${base}/${r.id}/pdf`} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-brand hover:underline">
                            PDF
                          </a>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
              <div className="mt-4 flex items-center justify-between text-[14px] text-muted">
                <span>
                  {t.count} {t.count === 1 ? "invoice" : "invoices"}
                  {data.pages > 1 && ` · page ${data.page} of ${data.pages}`}
                </span>
                {data.pages > 1 && (
                  <span className="flex gap-2">
                    {data.page > 1 && (
                      <Link href={`${base}${query(f, { page: data.page - 1 > 1 ? data.page - 1 : undefined })}`} className={buttonClass("secondary", "sm")}>
                        Previous page
                      </Link>
                    )}
                    {data.page < data.pages && (
                      <Link href={`${base}${query(f, { page: data.page + 1 })}`} className={buttonClass("secondary", "sm")}>
                        Next page
                      </Link>
                    )}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </>
  );
}
