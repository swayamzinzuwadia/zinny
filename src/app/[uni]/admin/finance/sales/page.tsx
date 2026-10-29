import Link from "next/link";
import { Card, Empty, Field, Input, Notice, PageHeader, Select, Stat, Table, Td, buttonClass, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { OrderPanel } from "@/modules/payments/components/order-panel";
import { SalesStatusBadge } from "@/modules/payments/components/status-badge";
import { inr } from "@/modules/payments/money";
import { invoiceDate } from "@/modules/payments/pdf/invoice-pdf";
import { SALES_STATUSES, STATUS_LABEL, orderDetail, parseFilters, salesOverview, type SalesFilters } from "@/modules/payments/sales";

export const metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function query(f: SalesFilters, extra: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.status) q.set("status", f.status);
  if (f.courseId) q.set("course", f.courseId);
  if (f.batchId) q.set("batch", f.batchId);
  if (f.q) q.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function SalesPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin/finance/sales`;

  if (!can(actor, "finance.view", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Sales" />
        <Empty title="You don't have access to Sales">Sales is for Institute Admins, Board / Owner and Accounts &amp; Fees. Ask an Institute Admin if you need it.</Empty>
      </>
    );
  }

  const f = parseFilters(sp);
  const data = await salesOverview(actor, f);
  const selected = typeof sp.order === "string" ? sp.order : "";
  const detail = selected ? await orderDetail(actor, selected).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))) : null;
  const pageQ = data.page > 1 ? data.page : undefined;
  const filtered = Boolean(f.from || f.to || f.status || f.courseId || f.batchId || f.q);
  const t = data.totals;

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle="Every order with its payment, GST invoice and refunds."
        actions={
          <>
            <Link href={`${base}/settings`} className={buttonClass("secondary", "sm")}>
              Invoice settings
            </Link>
            {/* Plain link: it downloads a file. */}
            <a href={`${base}/export${query(f)}`} className={buttonClass("secondary", "sm")}>
              Export CSV
            </a>
          </>
        }
      />

      <form method="get" className="mb-6 grid gap-3 rounded-[22px] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))] xl:grid-cols-[150px_150px_170px_1fr_1fr_1fr_auto]">
        <Field label="From">
          <Input type="date" name="from" defaultValue={f.from ?? ""} />
        </Field>
        <Field label="To">
          <Input type="date" name="to" defaultValue={f.to ?? ""} />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={f.status ?? ""}>
            <option value="">All statuses</option>
            {SALES_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Course">
          <Select name="course" defaultValue={f.courseId ?? ""}>
            <option value="">All courses</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Batch">
          <Select name="batch" defaultValue={f.batchId ?? ""}>
            <option value="">All batches</option>
            {data.courses.map((c) => {
              const bs = data.batches.filter((b) => b.courseId === c.id);
              return bs.length ? (
                <optgroup key={c.id} label={c.title}>
                  {bs.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </Select>
        </Field>
        <Field label="Student">
          <Input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Name, email or invoice" />
        </Field>
        <div className="flex items-end gap-2">
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
        <Stat label="Gross collected" value={inr(t.grossPaise)} hint={`${t.paidOrders} paid ${t.paidOrders === 1 ? "order" : "orders"}`} />
        <Stat label="GST" value={inr(t.gstPaise)} hint="On gross sales" />
        <Stat label="Refunds" value={inr(t.refundsPaise)} hint="Sent back to students" />
        <Stat label="Net" value={inr(t.netPaise)} hint="Gross minus refunds" />
      </div>

      {t.refundDue > 0 && f.status !== "refund_due" && (
        <div className="mb-6">
          <Notice tone="gold">
            {t.refundDue === 1 ? "One student" : `${t.refundDue} students`} paid after their batch filled up and {t.refundDue === 1 ? "needs" : "need"} a refund.{" "}
            <Link href={`${base}${query({ ...f, status: "refund_due" })}`} className="font-medium underline underline-offset-2">
              Show them
            </Link>
          </Notice>
        </div>
      )}

      <div className={cx("grid gap-6", detail && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
        {detail && (
          <div className="xl:order-2">
            <div className="xl:sticky xl:top-6">
              <OrderPanel uni={uni} d={detail} closeHref={`${base}${query(f, { page: pageQ })}`} />
            </div>
          </div>
        )}
        <div className="min-w-0 xl:order-1">
          {selected && !detail && (
            <div className="mb-4">
              <Notice tone="warn">That order wasn&apos;t found.</Notice>
            </div>
          )}
          {data.rows.length === 0 ? (
            <Empty title={filtered ? "No orders match these filters" : "No orders yet"}>{filtered ? "Change or clear the filters to see more." : "Orders appear here when students pick a paid batch."}</Empty>
          ) : (
            <>
              <Table head={["Date", "Student", "Course · Batch", "Amount", "Status", "GST invoice"]}>
                {data.rows.map((r) => {
                  const href = `${base}${query(f, { page: pageQ, order: r.id })}`;
                  return (
                    <tr key={r.id} className={cx("hover:bg-canvas/60", r.id === selected && "bg-brand-soft/50")}>
                      <Td className="whitespace-nowrap text-muted">{invoiceDate(r.day)}</Td>
                      <Td>
                        <Link href={href} scroll={false} className="font-medium hover:text-brand">
                          {r.studentName}
                        </Link>
                        <div className="text-[13px] text-muted">{r.studentEmail}</div>
                      </Td>
                      <Td>
                        {r.course} <span className="text-muted">· {r.batch}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="tabular">{inr(r.totalPaise)}</span>
                        {r.refundedPaise > 0 && <div className="tabular text-[12.5px] text-muted">−{inr(r.refundedPaise)} refunded</div>}
                      </Td>
                      <Td>
                        <SalesStatusBadge status={r.display} />
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-[13px]">{r.invoiceNumber ?? "–"}</Td>
                    </tr>
                  );
                })}
              </Table>
              <div className="mt-4 flex items-center justify-between text-[14px] text-muted">
                <span>
                  {t.matched} {t.matched === 1 ? "order" : "orders"}
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
      {!detail && data.rows.length > 0 && (
        <Card className="mt-6 p-4 text-[13px] text-muted">Select a student to see the payment ids, the GST invoice and refunds{data.can.refund ? ", and to send a refund" : ""}.</Card>
      )}
    </>
  );
}
