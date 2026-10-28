import { Badge, Empty, PageHeader, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatINR, listSales } from "@/server/services/finance";

export const metadata = { title: "Sales" };

const TONE = { paid: "brand", pending: "warn", refund_due: "danger", failed: "neutral", expired: "neutral", refunded: "neutral" } as const;

export default async function SalesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const sales = await listSales(actor);
  const paid = sales.filter((s) => s.status === "paid");
  const total = paid.reduce((n, s) => n + s.totalPaise, 0);
  const gst = paid.reduce((n, s) => n + s.gstPaise, 0);
  return (
    <>
      <PageHeader title="Sales" subtitle={`${paid.length} paid orders · ${formatINR(total)} collected · ${formatINR(gst)} GST`} />
      {sales.length === 0 ? (
        <Empty title="No orders yet" />
      ) : (
        <Table head={["Date", "Student", "Course · Batch", "Amount", "Status", "GST invoice"]}>
          {sales.map((s) => (
            <tr key={s.id}>
              <Td className="whitespace-nowrap text-muted">{s.createdAt.toLocaleDateString("en-IN")}</Td>
              <Td className="font-medium">{s.buyer}</Td>
              <Td>
                {s.course} <span className="text-muted">· {s.batch}</span>
              </Td>
              <Td className="tabular-nums">{formatINR(s.totalPaise)}</Td>
              <Td>
                <Badge tone={TONE[s.status]}>{s.status === "refund_due" ? "Refund due" : s.status}</Badge>
              </Td>
              <Td className="font-mono text-[13px]">{s.invoiceNumber ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
