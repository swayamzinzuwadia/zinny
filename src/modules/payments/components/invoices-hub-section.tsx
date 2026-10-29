import Link from "next/link";
import type { HubSectionProps } from "@/contracts/module";
import { Card, CardTitle } from "@/components/ui";
import { myInvoices } from "../invoices";
import { inr } from "../money";
import { invoiceDate } from "../pdf/invoice-pdf";

/** learnerHubSections: the learner's latest GST invoices on My learning, linking to all of them. */
export async function InvoicesHubSection({ uni, actor }: HubSectionProps) {
  const all = await myInvoices(actor);
  if (all.length === 0) return null;
  const latest = all.slice(0, 3);
  return (
    <Card>
      <CardTitle
        hint={
          <Link href={`/${uni}/learn/invoices`} className="font-medium text-brand hover:underline">
            All invoices
          </Link>
        }
      >
        Invoices
      </CardTitle>
      <ul className="divide-y divide-line">
        {latest.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{i.course}</div>
              <div className="text-[13px] text-muted">
                {invoiceDate(i.issuedOn)} · {inr(i.totalPaise)}
              </div>
            </div>
            {/* A plain link: the download is a file, not a page to prefetch. */}
            <a href={`/${uni}/learn/invoices/${i.id}`} className="shrink-0 text-[13px] font-medium text-brand hover:underline">
              Download PDF
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
