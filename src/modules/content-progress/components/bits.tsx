/**
 * Small presentational pieces used across this module's screens (server-safe: no hooks).
 */
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import type { LessonKind } from "../lib/kinds";

/** A progress bar. Gold is kept for "now"; progress is brand green. */
export function ProgressBar({ percent, className, label }: { percent: number; className?: string; label?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className={cx("h-2 overflow-hidden rounded-full bg-line", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p}
      aria-label={label ?? `${p}% complete`}
    >
      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${p}%` }} />
    </div>
  );
}

const PATHS: Record<LessonKind | "done" | "locked" | "open", ReactNode> = {
  video: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h7A1.5 1.5 0 0 1 14 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 13.5v-7Zm10 2.2 3.2-2a.5.5 0 0 1 .8.4v5.8a.5.5 0 0 1-.8.4l-3.2-2" />,
  pdf: <path d="M6 3.5h5.5L15 7v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Zm5 0V7h4M7.5 11h5M7.5 13.5h5" />,
  text: <path d="M5 5.5h10M5 8.5h10M5 11.5h10M5 14.5h6" />,
  link: <path d="M8.5 11.5l3-3M7.4 9.6 6 11a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M12.6 10.4 14 9a2.5 2.5 0 0 0-3.5-3.5L9.1 6.9" />,
  live: <path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5.2 2.2a7.4 7.4 0 0 1 0-10.4m10.4 0a7.4 7.4 0 0 1 0 10.4" />,
  done: <path d="m6 10.5 2.6 2.5L14 7.5" />,
  locked: <path d="M6.5 9V7.5a3.5 3.5 0 0 1 7 0V9M5.5 9h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z" />,
  open: <circle cx="10" cy="10" r="5.5" />,
};

export function Icon({ name, size = 18, className }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/** The round marker in front of a lesson in an outline. */
export function StateDot({ state, kind }: { state: "done" | "open" | "locked"; kind: LessonKind }) {
  if (state === "done") {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-canvas" title="Completed">
        <Icon name="done" size={16} />
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-faint" title="Locked">
        <Icon name="locked" size={15} />
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand-soft text-brand-strong">
      <Icon name={kind} size={16} />
    </span>
  );
}

/**
 * Styles for sanitised lesson HTML (tags allowed by lib/sanitize.ts only).
 * Readable line length and size on phones; links in brand green.
 */
export const PROSE = cx(
  "max-w-none text-[16px] leading-[1.75] text-ink",
  "[&_p]:my-4 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:leading-snug",
  "[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-[18px] [&_h3]:font-semibold [&_h4]:mt-5 [&_h4]:font-semibold",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5",
  "[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-5 [&_blockquote]:border-l-4 [&_blockquote]:border-brand/30 [&_blockquote]:pl-4 [&_blockquote]:text-muted",
  "[&_code]:rounded-md [&_code]:bg-canvas [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[14px]",
  "[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-brand-deep [&_pre]:p-4 [&_pre]:text-[13.5px] [&_pre]:leading-relaxed [&_pre]:text-canvas",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-canvas",
  "[&_hr]:my-8 [&_hr]:border-line [&_strong]:font-semibold [&>*:first-child]:mt-0",
);
