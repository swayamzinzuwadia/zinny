import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, Card, CardTitle, Empty, PageHeader, Stat, Tabs, Td, cx, ActionLink } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { renewNowAction, setAutoRenewAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess, PanelTable, WIDE_ONLY } from "@/modules/zinny-team-panel/components/bits";
import { formatCount, formatDate, formatINR, formatINRShort, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { upcomingRenewals, type UpcomingRenewal } from "@/modules/zinny-team-panel/services/automation";
import { listInvoices } from "@/modules/zinny-team-panel/services/billing";

export const metadata = { title: "Invoices" };

const COMING_UP_DAYS = 60;
const COMING_UP_CAP = 8;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; university?: string; all?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.finance")) return <NoAccess section="Invoices" />;
  const f = await searchParams;
  const [{ filter, invoices, summary }, upcoming] = await Promise.all([
    listInvoices(actor, { status: f.status, universityId: f.university }),
    upcomingRenewals(actor, COMING_UP_DAYS),
  ]);
  const canRenew = canPlatform(actor, "platform.licences");
  const href = (s: string) => `/platform/billing?status=${s}${f.university ? `&university=${f.university}` : ""}`;
  const shown = f.all ? upcoming : upcoming.slice(0, COMING_UP_CAP);
  const today = todayIST();

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Zinny's GST invoices to institutes. Licences invoice themselves when they are set up and when they renew; an unpaid invoice can be revised."
        actions={<ButtonLink href={`/platform/billing/new${f.university ? `?university=${f.university}` : ""}`}>New invoice</ButtonLink>}
      />

      <Card className="mb-6">
        <CardTitle hint={`Next ${COMING_UP_DAYS} days`}>Coming up</CardTitle>
        {upcoming.length === 0 ? (
          <p className="text-[14px] text-muted">No licence ends in the next {COMING_UP_DAYS} days.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <ComingUpRow key={r.universityId} r={r} canRenew={canRenew} today={today} />
            ))}
          </ul>
        )}
        {upcoming.length > shown.length && (
          <ActionLink href="/platform/billing?all=1" className="mt-3" icon="view">
            See all {upcoming.length}
          </ActionLink>
        )}
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Outstanding" value={formatINRShort(summary.outstanding)} hint={`${formatCount(summary.unpaidCount)} unpaid invoice${summary.unpaidCount === 1 ? "" : "s"}`} />
        <Stat
          label="Overdue"
          value={<span className={summary.overdue > 0 ? "text-danger" : undefined}>{formatINRShort(summary.overdue)}</span>}
          hint={`${formatCount(summary.overdueCount)} past the due date`}
        />
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
                {i.discountPaise > 0 && <div className="text-[13px] text-muted">after {formatINR(i.discountPaise)} off</div>}
              </Td>
              <Td className={cx(WIDE_ONLY, "tabular whitespace-nowrap text-muted")}>{formatINR(i.cgstPaise + i.sgstPaise + i.igstPaise)}</Td>
              <Td className={cx("tabular whitespace-nowrap font-medium", i.overdue && "text-danger")}>{formatINR(i.totalPaise)}</Td>
              <Td className="whitespace-nowrap">
                {formatDate(i.dueDate)}
                {i.status === "unpaid" && i.lastReminderOn && <div className="text-[13px] text-muted">Reminded {formatDate(i.lastReminderOn, { year: false })}</div>}
              </Td>
              <Td className="whitespace-nowrap">
                {i.status === "paid" ? <Badge tone="brand">Paid</Badge> : i.overdue ? <span className="text-[13px] font-medium text-danger">Overdue</span> : <Badge>Unpaid</Badge>}
              </Td>
            </tr>
          ))}
        </PanelTable>
      )}
    </>
  );
}

/** One licence coming up for renewal: when, on what, for how much, and what happens. */
function ComingUpRow({ r, canRenew, today }: { r: UpcomingRenewal; canRenew: boolean; today: string }) {
  const ended = r.daysLeft < 0;
  const when = ended ? `Ended ${formatDate(r.endDate, { year: false })}` : r.daysLeft === 0 ? "Ends today" : `Ends ${formatDate(r.endDate, { year: false })}`;
  const how = r.planArchived
    ? "Plan archived: pick a plan to renew"
    : !r.autoRenew
      ? "Auto-renew off"
      : ended
        ? "Renew it by hand"
        : r.invoiceOn <= today
          ? "Invoiced at the next daily billing run"
          : `Invoiced automatically on ${formatDate(r.invoiceOn, { year: false })}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-[260px] text-[14px]">
        <Link href={`/platform/licences/${r.universityId}`} className="font-medium text-ink hover:text-brand">
          {r.universityName}
        </Link>
        <div className="text-[13px] text-muted">
          <span className={cx(ended && "text-danger")}>{when}</span> · {r.planName} · {how}
        </div>
      </div>
      <div className="tabular w-[120px] shrink-0 text-right text-[14px]">
        {r.totalPaise > 0 ? formatINR(r.totalPaise) : "Nothing to charge"}
        <div className="text-[13px] text-muted">{r.discountPaise > 0 ? "after discount, with GST" : "with GST"}</div>
      </div>
      {canRenew && (
        <div className="flex w-full shrink-0 items-center justify-end gap-4 sm:w-[260px]">
          {r.planArchived ? (
            <ActionLink href={`/platform/licences/${r.universityId}`} icon="forward">
              Pick a plan
            </ActionLink>
          ) : (
            <ActionForm action={renewNowAction} confirm={`Renew ${r.universityName}'s licence now? It is invoiced for ${formatINR(r.totalPaise)} today.`}>
              <input type="hidden" name="universityId" value={r.universityId} />
              <SubmitButton size="sm" variant="secondary" pendingText="Renewing…">
                Renew now
              </SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={setAutoRenewAction}>
            <input type="hidden" name="universityId" value={r.universityId} />
            <input type="hidden" name="autoRenew" value={r.autoRenew ? "off" : "on"} />
            <SubmitButton size="sm" variant="quiet" pendingText="Saving…">
              {r.autoRenew ? "Turn off auto-renew" : "Turn on auto-renew"}
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </li>
  );
}
