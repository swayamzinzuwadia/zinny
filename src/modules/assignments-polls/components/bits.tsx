/** Small display pieces shared by this module's pages and slots (server components). */
import { Badge, cx } from "@/components/ui";
import { formatBytes } from "../lib/files";
import { formatMarks } from "../lib/grading";
import { sanitizeInstructions } from "../lib/sanitize";
import { fileHref } from "../links";
import type { LearnerStatus } from "../service/assignments";

/** Sanitised again on the way out, so nothing unsafe reaches the page even if the stored HTML were edited. */
export function Instructions({ html, className }: { html: string; className?: string }) {
  const clean = sanitizeInstructions(html);
  if (!clean) return <p className={cx("text-[14px] text-muted", className)}>No instructions. Check the attached files.</p>;
  return (
    <div
      className={cx(
        "max-w-none text-[15px] leading-relaxed",
        "[&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted",
        "[&_code]:rounded [&_code]:bg-canvas [&_code]:px-1 [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-[16px] [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-semibold",
        "[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-canvas [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

export type FileItem = { id: string; fileName: string; sizeBytes: number };

/** Links that open files through the access-checked route. Plain anchors: they must not be prefetched. */
export function FileLinks({ uni, files, area, empty }: { uni: string; files: FileItem[]; area: "admin" | "learn"; empty?: string }) {
  if (files.length === 0) return empty ? <p className="text-[14px] text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id}>
          <a
            href={fileHref(uni, f.id, area)}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] hover:border-brand/40"
          >
            <FileIcon />
            <span className="min-w-0 truncate text-brand group-hover:underline">{f.fileName}</span>
            <span className="shrink-0 text-[12px] text-faint">{formatBytes(f.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden className="shrink-0 text-muted">
      <path d="M2 1h6l4 4v10H2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 1v4h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

const STATUS: Record<LearnerStatus, { label: string; tone: "neutral" | "brand" | "gold" | "warn" | "danger" }> = {
  due: { label: "To do", tone: "neutral" },
  overdue: { label: "Overdue", tone: "danger" },
  missed: { label: "Missed", tone: "danger" },
  submitted: { label: "Handed in", tone: "brand" },
  graded: { label: "Graded", tone: "brand" },
};

export function StatusBadge({ status, late, dueSoon }: { status: LearnerStatus; late?: boolean; dueSoon?: boolean }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={status === "due" && dueSoon ? "gold" : s.tone}>{status === "due" && dueSoon ? "Due soon" : s.label}</Badge>
      {late && (status === "submitted" || status === "graded") && <Badge tone="warn">Late</Badge>}
    </span>
  );
}

/** "8 / 10" with the percentage. */
export function Score({ marks, points, percent, className }: { marks: number | null; points: number; percent?: number | null; className?: string }) {
  if (marks === null) return null;
  return (
    <span className={cx("tabular", className)}>
      <span className="font-semibold">{formatMarks(marks)}</span>
      <span className="text-muted"> / {points}</span>
      {percent !== null && percent !== undefined && <span className="ml-1.5 text-[13px] text-muted">{Math.round(percent)}%</span>}
    </span>
  );
}

/** Horizontal bars for poll results. The leading option is in brand green; nothing is gold. */
export function ResultBars({ options, total }: { options: { id: string; label: string; votes: number; percent: number; voters?: string[] }[]; total: number }) {
  const top = Math.max(0, ...options.map((o) => o.votes));
  return (
    <ul className="space-y-2.5">
      {options.map((o) => (
        <li key={o.id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[14px]">
            <span className={cx("min-w-0", o.votes === top && top > 0 && "font-medium")}>{o.label}</span>
            <span className="tabular shrink-0 text-[13px] text-muted">
              {o.votes} {o.votes === 1 ? "vote" : "votes"}
              {total > 0 && ` · ${Math.round(o.percent)}%`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line" role="img" aria-label={`${o.label}: ${o.votes} of ${total} votes`}>
            <div className={cx("h-full rounded-full", o.votes === top && top > 0 ? "bg-brand" : "bg-brand/40")} style={{ width: `${total ? (o.votes / total) * 100 : 0}%` }} />
          </div>
          {o.voters && o.voters.length > 0 && <p className="mt-1 text-[12px] text-muted">{o.voters.join(", ")}</p>}
        </li>
      ))}
    </ul>
  );
}
