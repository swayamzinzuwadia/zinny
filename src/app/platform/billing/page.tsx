import Link from "next/link";
import { Badge, ButtonLink, Empty, PageHeader, Stat, Tabs, Td, cx } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NoAccess, PanelTable, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { formatCount, formatDate, formatINR, formatINRShort } from "@/modules/zinny-team-panel/lib/format";
import { listInvoices } from "@/modules/zinny-team-panel/services/billing";

export const metadata = { title: "Zinny invoices" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; university?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.finance")) return <NoAccess section="Zinny invoices" />;
  const f = await searchParams;
  const { filter, invoices, summary } = await listInvoices(actor, { status: f.status, universityId: f.university });
  const href = (s: string) => `/platform/billing?status=${s}${f.university ? `&university=${f.university}` : ""}`;

  return (
    <>
      <PageHeader
        title="Zinny invoices"
        subtitle="Zinny's GST invoices to institutes for their licences. A licence raises its own invoice; an unpaid one can be revised. These are separate from the invoices institutes issue to their students."
        actions={<ButtonLink href={`/platform/billing/new${f.university ? `?university=${f.university}` : ""}`}>New invoice</ButtonLink>}
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Outstanding" value={formatINRShort(summary.outstanding)} hint={`${formatCount(summary.unpaidCount)} unpaid invoice${summary.unpaidCount === 1 ? "" : "s"}`} />
        <Stat label="Overdue" value={formatINRShort(summary.overdue)} hint={`${formatCount(summary.overdueCount)} past the due date`} />
        <Stat label={`Collected in FY ${summary.financialYear}`} value={formatINRShort(summary.collectedFy)} hint="Marked paid since 1 April" />
      </div>
      <Tabs
        active={filter}
        tabs={[
          { key: "all", label: "All", href: href("all") },
          { key: "unpaid", label: "Unpaid", href: href("unpaid") },
          { key: "overdue", label: "Overdue", href: href("overdue") },
          { key: "paid", label: "Paid", href: href("paid") },
        ]}
      />
      {invoices.length === 0 ? (
        <Empty title="No invoices here">Setting up or renewing a licence raises one. You can also issue one from New invoice.</Empty>
      ) : (
        <PanelTable
          head={[
            "Number",
            "Institute",
            { label: "Period", className: WIDE_ONLY },
            { label: "Amount", className: WIDE_ONLY },
            { label: "GST", className: WIDE_ONLY },
            "Total",
            "Due",
            "Status",
          ]}
        >
          {invoices.map((i) => (
            <tr key={i.id} className="hover:bg-canvas/60">
              <Td className="whitespace-nowrap">
                <Link href={`/platform/billing/${i.id}`} className="tabular text-[13px] font-medium text-ink hover:text-brand">
                  {i.number}
                </Link>
              </Td>
              <Td>{i.universityName}</Td>
              <Td className={cx(WIDE_ONLY, "whitespace-nowrap text-[13px] text-muted")}>
                {formatDate(i.periodStart, { year: false })} to {formatDate(i.periodEnd)}
              </Td>
              <Td className={cx(WIDE_ONLY, "tabular whitespace-nowrap")}>
                {formatINR(i.basePaise)}
                {i.discountPaise > 0 && <div className="text-[12.5px] text-muted">after {formatINR(i.discountPaise)} off</div>}
              </Td>
              <Td className={cx(WIDE_ONLY, "tabular whitespace-nowrap text-muted")}>{formatINR(i.cgstPaise + i.sgstPaise + i.igstPaise)}</Td>
              <Td className="tabular whitespace-nowrap font-medium">{formatINR(i.totalPaise)}</Td>
              <Td className="whitespace-nowrap">{formatDate(i.dueDate)}</Td>
              <Td>{i.status === "paid" ? <Badge tone="brand">Paid</Badge> : i.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="gold">Unpaid</Badge>}</Td>
            </tr>
          ))}
        </PanelTable>
      )}
    </>
  );
}
