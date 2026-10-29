/** Small building blocks shared by the /platform pages. Server components. */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Empty, cx } from "@/components/ui";
import { PLAN_LABELS, type Plan } from "../lib/constants";
import { formatCount } from "../lib/format";

/** Shown instead of a section the person's platform roles don't open. */
export function NoAccess({ section, who }: { section: string; who: string }) {
  return (
    <div className="mx-auto max-w-xl pt-10">
      <Empty title={`You don't have access to ${section}`}>
        {who} can open this section. Ask a Super Admin if you need it for your work.
        <div className="mt-4">
          <Link href="/platform" className="text-[14px] font-medium text-brand hover:underline">
            Back to the platform home
          </Link>
        </div>
      </Empty>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return status === "active" ? <Badge tone="brand">Active</Badge> : status === "suspended" ? <Badge tone="danger">Suspended</Badge> : <Badge>{status}</Badge>;
}

export function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return <Badge tone="warn">No licence</Badge>;
  return <Badge tone={plan === "enterprise" ? "brand" : "neutral"}>{PLAN_LABELS[plan as Plan] ?? plan}</Badge>;
}

/**
 * Usage against a cap. Green while there is room, gold from 90% (needs attention),
 * red when over the cap.
 */
export function UsageMeter({ label, used, cap, compact }: { label?: string; used: number; cap: number | null; compact?: boolean }) {
  if (!cap) {
    return <span className="tabular text-[14px]">{formatCount(used)}</span>;
  }
  const ratio = used / cap;
  const tone = ratio > 1 ? "bg-danger" : ratio >= 0.9 ? "bg-gold" : "bg-brand";
  const pct = Math.min(100, ratio * 100);
  return (
    <div className={cx(compact ? "min-w-[120px]" : "w-full")}>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        {label && <span className="text-muted">{label}</span>}
        <span className="tabular">
          <span className={cx("font-medium", ratio > 1 ? "text-danger" : ratio >= 0.9 ? "text-gold-strong" : "text-ink")}>{formatCount(used)}</span>
          <span className="text-muted"> of {formatCount(cap)}</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-label={label ?? "Usage"}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={used}
      >
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** "Ends in 22 days" / "Ended 3 days ago" for a licence end date. */
export function RenewalText({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return <span className="text-danger">Ended {Math.abs(daysLeft)} day{daysLeft === -1 ? "" : "s"} ago</span>;
  if (daysLeft === 0) return <span className="text-gold-strong">Ends today</span>;
  if (daysLeft <= 30) return <span className="text-gold-strong">In {daysLeft} day{daysLeft === 1 ? "" : "s"}</span>;
  return <span className="text-muted">In {daysLeft} days</span>;
}

/** A labelled value in a definition grid. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px]">{children || <span className="text-faint">Not set</span>}</dd>
    </div>
  );
}

/** A plain link styled as a back link above a page header. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-block text-[13px] text-muted hover:text-brand">
      {children}
    </Link>
  );
}

/** Notice for filters that were ignored because they were malformed. */
export function FilterProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <p className="mb-4 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
      Ignored the {problems.join(", ")} filter{problems.length === 1 ? "" : "s"}: the value wasn&apos;t valid. Pick it again from the list.
    </p>
  );
}
