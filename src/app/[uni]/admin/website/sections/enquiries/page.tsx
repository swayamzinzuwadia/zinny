import Link from "next/link";
import { Badge, Empty, PageHeader, Table, Tabs, Td, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite } from "@/modules/website-builder/access";
import { NoAccess, SectionTabs } from "@/modules/website-builder/components/admin";
import { ENQUIRY_STATUS_LABEL, listEnquiries, type EnquiryFilter, type EnquiryStatus } from "@/modules/website-builder/enquiries";
import { formatMoment, truncate } from "@/modules/website-builder/format";
import { attentionCounts } from "@/modules/website-builder/overview";

export const metadata = { title: "Enquiries" };

const STATUSES: (EnquiryStatus | "all")[] = ["new", "contacted", "closed", "all"];
const TONE = { new: "gold", contacted: "brand", closed: "neutral" } as const;

export default async function EnquiriesPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ show?: string; who?: string }> }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    return (
      <>
        <PageHeader title="Enquiries" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const status = (STATUSES.includes(sp.show as EnquiryStatus) ? sp.show : "new") as EnquiryStatus | "all";
  const assignee = (["me", "unassigned"].includes(sp.who ?? "") ? sp.who : "anyone") as EnquiryFilter["assignee"];
  const [{ rows, counts }, attention] = await Promise.all([listEnquiries(actor, { status, assignee }), attentionCounts(actor)]);
  const base = `/${uni}/admin/website/sections/enquiries`;
  const q = (s: string, w: string | undefined) => `${base}?show=${s}${w && w !== "anyone" ? `&who=${w}` : ""}`;
  const total = Object.values(counts).reduce((n, c) => n + (c ?? 0), 0);

  return (
    <>
      <PageHeader title="Enquiries" subtitle="Questions sent from your website's enquiry form. Reply by email or phone, then mark them as contacted, and close them when you're done." />
      <SectionTabs uni={uni} active="enquiries" counts={attention} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Tabs
          active={status}
          tabs={STATUSES.map((s) => ({ key: s, label: s === "all" ? "All" : ENQUIRY_STATUS_LABEL[s], href: q(s, assignee), count: s === "all" ? total : (counts[s] ?? 0) }))}
        />
        <nav className="mb-7 flex gap-1 text-[13px]" aria-label="Assigned to">
          {[
            ["anyone", "Everyone's"],
            ["me", "Mine"],
            ["unassigned", "Unassigned"],
          ].map(([k, label]) => (
            <Link key={k} href={q(status, k)} aria-current={assignee === k ? "true" : undefined} className={cx("rounded-full px-3 py-1.5", assignee === k ? "bg-brand-soft font-medium text-brand-strong" : "text-muted hover:text-ink")}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <Empty title={status === "new" ? "No new enquiries" : "No enquiries here"}>
          {status === "new" ? "New enquiries from your website show up here, and you get a notification for each one." : "Try another tab."}
        </Empty>
      ) : (
        <Table head={["From", "Course", "Message", "Received", "Status", "Assigned to"]}>
          {rows.map((e) => (
            <tr key={e.id} className={cx("hover:bg-canvas/60", e.status === "new" && "bg-gold-soft/25")}>
              <Td>
                <Link href={`${base}/${e.id}`} className="font-medium text-ink hover:text-brand">
                  {e.name}
                </Link>
                <div className="text-[13px] text-muted">{e.email}</div>
                {e.phone && <div className="text-[13px] text-muted">{e.phone}</div>}
              </Td>
              <Td className="text-muted">{e.courseTitle ?? "General"}</Td>
              <Td className="max-w-xs text-[13px] text-ink/80">{e.message ? truncate(e.message, 110) : <span className="text-faint">No message</span>}</Td>
              <Td className="whitespace-nowrap text-[13px] text-muted">{formatMoment(e.createdAt, university.timezone)}</Td>
              <Td>
                <Badge tone={TONE[e.status]}>{ENQUIRY_STATUS_LABEL[e.status]}</Badge>
              </Td>
              <Td className="text-[13px]">{e.assigneeName ?? <span className="text-faint">Nobody</span>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
