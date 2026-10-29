import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, cx, Empty, Stat, Table, Td } from "@/components/ui";
import { retryDeliveryAction } from "../actions";
import { CHANNEL_LABEL, CHANNELS } from "../kinds";
import type { Channel, DeliveryStatus } from "../schema";
import type { DeliveryLogRow } from "../service";
import { formatWhen } from "./format";

const STATUS: Record<DeliveryStatus, { label: string; tone: "brand" | "gold" | "danger" | "neutral" | "warn" }> = {
  sent: { label: "Sent", tone: "brand" },
  queued: { label: "Waiting", tone: "gold" },
  sending: { label: "Sending", tone: "gold" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Not sent", tone: "neutral" },
};

const SOURCE: Record<DeliveryLogRow["source"], string> = { notification: "Notification", direct: "Direct", test: "Test" };

function waitingNote(r: DeliveryLogRow, timezone: string) {
  if (r.status !== "queued" || !r.nextAttemptAt) return null;
  if (r.attempts > 0) return `Trying again ${formatWhen(r.nextAttemptAt, timezone)}`;
  if (r.nextAttemptAt.getTime() > Date.now() + 60_000) return `Quiet hours: goes out ${formatWhen(r.nextAttemptAt, timezone)}`;
  return "Goes out within a minute";
}

export function DeliveryLog({
  uni,
  rows,
  stats,
  timezone,
  filter,
  baseHref,
}: {
  uni: string;
  rows: DeliveryLogRow[];
  stats: { sent: number; queued: number; failed: number; skipped: number };
  timezone: string;
  filter: { status: string; channel: string };
  baseHref: string;
}) {
  const link = (patch: Partial<{ status: string; channel: string }>) => {
    const next = { ...filter, ...patch };
    const q = new URLSearchParams({ tab: "log", ...(next.status && { status: next.status }), ...(next.channel && { channel: next.channel }) });
    return `${baseHref}?${q}`;
  };
  const chip = (active: boolean) =>
    cx("rounded-full px-3 py-1 text-[13px]", active ? "bg-brand text-canvas" : "border border-line bg-surface text-muted hover:text-ink");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sent" value={stats.sent} hint="Last 7 days" />
        <Stat label="Waiting" value={stats.queued} hint="Queued, quiet hours or retrying" />
        <Stat label="Failed" value={stats.failed} hint={stats.failed ? "Needs a look" : "Last 7 days"} />
        <Stat label="Not sent" value={stats.skipped} hint="No number, or unsubscribed" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          ["", "All"],
          ["failed", "Failed"],
          ["queued", "Waiting"],
          ["sent", "Sent"],
          ["skipped", "Not sent"],
        ].map(([v, l]) => (
          <Link key={v} href={link({ status: v })} className={chip(filter.status === v)}>
            {l}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {(["", ...CHANNELS] as ("" | Channel)[]).map((c) => (
          <Link key={c || "all"} href={link({ channel: c })} className={chip(filter.channel === c)}>
            {c ? CHANNEL_LABEL[c] : "Every channel"}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty title="No messages here">Messages appear here as notifications go out.</Empty>
      ) : (
        <Table head={["When", "To", "Message", "Channel", "Status", ""]}>
          {rows.map((r) => {
            const note = waitingNote(r, timezone);
            return (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-[13px] text-muted">{formatWhen(r.createdAt, timezone)}</Td>
                <Td>
                  <div className="font-medium">{r.personName ?? r.recipient ?? "No address"}</div>
                  {r.personName && r.recipient && <div className="text-[12.5px] text-muted">{r.recipient}</div>}
                </Td>
                <Td>
                  <div className="max-w-sm truncate">{r.security ? `${r.label} (not stored)` : (r.subject ?? r.label)}</div>
                  <div className="text-[12.5px] text-muted">
                    {r.label} · {SOURCE[r.source]}
                  </div>
                </Td>
                <Td className="text-[13px]">{CHANNEL_LABEL[r.channel]}</Td>
                <Td>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  {r.status === "sent" && r.sentAt && <div className="mt-1 text-[12px] text-muted">{formatWhen(r.sentAt, timezone)}</div>}
                  {note && <div className="mt-1 text-[12px] text-muted">{note}</div>}
                  {r.lastError && r.status !== "sent" && <div className="mt-1 max-w-xs text-[12px] leading-snug text-muted">{r.lastError}</div>}
                  {r.attempts > 1 && <div className="mt-1 text-[12px] text-faint">{r.attempts} attempts</div>}
                </Td>
                <Td className="text-right">
                  {r.retryable && (
                    <ActionForm action={retryDeliveryAction} resetOnSuccess={false}>
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="deliveryId" value={r.id} />
                      <SubmitButton variant="secondary" size="sm" pendingText="Queuing…">
                        Send again
                      </SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
