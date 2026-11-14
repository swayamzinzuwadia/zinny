import { cx } from "./ui";

const bar = "rounded-full bg-line/70";

/** A dashboard page while it loads: same header and rows, so nothing jumps when it arrives. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="page-skeleton">
      <div className={cx(bar, "h-8 w-64 max-w-full")} />
      <div className={cx(bar, "mt-3 mb-8 h-4 w-96 max-w-full")} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface px-5 py-4">
            <div className={cx(bar, "h-3 w-24")} />
            <div className={cx(bar, "mt-3 h-7 w-20")} />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-surface">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-6 border-b border-line px-5 py-4 last:border-b-0">
            <div className={cx(bar, "h-3.5 w-1/3")} />
            <div className={cx(bar, "h-3.5 w-1/5")} />
            <div className={cx(bar, "ml-auto h-3.5 w-16")} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A learner page while it loads: a heading and a stack of cards, for phones first. */
export function LearnSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="page-skeleton">
      <div className={cx(bar, "h-7 w-48 max-w-full")} />
      <div className={cx(bar, "mt-3 mb-6 h-4 w-72 max-w-full")} />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">
            <div className={cx(bar, "h-4 w-1/2")} />
            <div className={cx(bar, "mt-3 h-3.5 w-3/4")} />
          </div>
        ))}
      </div>
    </div>
  );
}
