import { Badge } from "@/components/ui";
import { STATUS_LABEL, type SalesStatus } from "../sales";

/** Gold marks what needs attention (a refund to send); green is money in. */
const TONE: Record<SalesStatus, "brand" | "gold" | "neutral" | "warn" | "danger"> = {
  paid: "brand",
  partly_refunded: "neutral",
  refund_due: "gold",
  refunded: "neutral",
  pending: "warn",
  failed: "neutral",
  expired: "neutral",
};

export function SalesStatusBadge({ status }: { status: SalesStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const REFUND_TONE = { requested: "warn", pending: "warn", processed: "brand", failed: "danger" } as const;
const REFUND_LABEL = { requested: "Waiting for Razorpay", pending: "Processing", processed: "Refunded", failed: "Failed" } as const;

export function RefundStatusBadge({ status }: { status: keyof typeof REFUND_TONE }) {
  return <Badge tone={REFUND_TONE[status]}>{REFUND_LABEL[status]}</Badge>;
}

const INVOICE_TONE = { paid: "brand", unpaid: "neutral", overdue: "gold", cancelled: "neutral" } as const;
const INVOICE_LABEL = { paid: "Paid", unpaid: "Unpaid", overdue: "Overdue", cancelled: "Cancelled" } as const;

/** Invoices: gold marks the one thing that needs attention, an unpaid invoice past its due date. */
export function InvoiceStatusBadge({ status, overdue = false }: { status: "paid" | "unpaid" | "cancelled"; overdue?: boolean }) {
  const key = status === "unpaid" && overdue ? "overdue" : status;
  return <Badge tone={INVOICE_TONE[key]}>{INVOICE_LABEL[key]}</Badge>;
}
