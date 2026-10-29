import { cx } from "@/components/ui";

/**
 * A certificate drawn as SVG (by the module's own renderer, which escapes every piece of
 * text). The paper keeps A4 landscape proportions at any width.
 */
export function CertificateArt({ svg, className, label }: { svg: string; className?: string; label?: string }) {
  return (
    <div
      className={cx("overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_38_31/0.06),0_8px_24px_-12px_rgb(20_38_31/0.18)]", className)}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
