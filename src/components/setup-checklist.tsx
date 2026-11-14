import Link from "next/link";
import type { SetupChecklist } from "@/server/services/setup";
import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { Card, cx } from "./ui";

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        done ? "bg-brand text-canvas" : "border border-line bg-surface",
      )}
    >
      {done && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
    </span>
  );
}

/**
 * The admin dashboard's "Get set up" card for a new institute. Each item is done or not from
 * real data; the next step to take is the only one in gold.
 */
export function SetupChecklistCard({ uni, checklist, dismiss }: { uni: string; checklist: SetupChecklist; dismiss: FormAction }) {
  const pct = Math.round((checklist.done / checklist.total) * 100);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-medium">Get set up</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {checklist.done} of {checklist.total} done. Each step ticks itself off as you go.
          </p>
        </div>
        <ActionForm action={dismiss} resetOnSuccess={false}>
          <input type="hidden" name="uni" value={uni} />
          <SubmitButton variant="ghost" size="sm" pendingText="Hiding…">
            Hide checklist
          </SubmitButton>
        </ActionForm>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={checklist.done} aria-valuemin={0} aria-valuemax={checklist.total} aria-label="Setup progress">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 lg:grid-cols-2">
        {checklist.items.map((item) => {
          const next = item.key === checklist.next;
          return (
            <li key={item.key} className={cx("flex items-start gap-3 rounded-xl px-3.5 py-3", next ? "bg-gold-soft" : "bg-canvas/60")}>
              <Tick done={item.done} />
              <div className="min-w-0 flex-1">
                <div className={cx("text-[14px] font-medium", item.done && "text-muted line-through decoration-line")}>{item.label}</div>
                {!item.done && <div className="text-[13px] text-muted">{item.hint}</div>}
              </div>
              {!item.done && (
                <Link
                  href={item.href}
                  className={cx(
                    "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap",
                    next ? "bg-brand text-canvas hover:bg-brand-strong" : "text-brand hover:bg-brand-soft",
                  )}
                >
                  {item.action}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
