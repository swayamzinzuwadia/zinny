import type { Clash } from "@/server/core";
import { clashSentence } from "@/server/lib/clashes";
import { cx } from "@/components/ui";

/**
 * The timetable clash warning on the marketplace: names the other batch and when they meet
 * together. Gold, because it needs attention; never a block.
 */
export function ClashNote({ clashes, subject = "This batch", className, after }: { clashes: Clash[] | undefined; subject?: string; className?: string; after?: string }) {
  if (!clashes || clashes.length === 0) return null;
  return (
    <p role="status" className={cx("rounded-2xl bg-gold-soft px-4 py-3 text-[14px] leading-relaxed text-brand-deep", className)}>
      <span className="font-semibold">Timetable clash. </span>
      {clashSentence(clashes, subject)} {after ?? "You can still buy it."}
    </p>
  );
}
