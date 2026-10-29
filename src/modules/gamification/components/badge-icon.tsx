import type { ReactNode } from "react";
import { BADGE_ICON_LABELS, isBadgeIcon, type BadgeIconKey } from "../catalog";

/**
 * The built-in badge icons: a medallion in brand green with a cream glyph. Locked badges
 * are drawn in outline; a badge earned in the last week gets a gold ring (gold = "now").
 * Glyphs are drawn on a 24-unit grid, centred in a 48-unit medallion.
 */
const GLYPHS: Record<BadgeIconKey, ReactNode> = {
  star: <path d="M12 3.6l2.55 5.2 5.7.83-4.13 4.02.98 5.68L12 16.65l-5.1 2.68.98-5.68L3.75 9.63l5.7-.83z" />,
  flame: (
    <>
      <path d="M12 2.8c.7 3.3 5 5.2 5 10a5 5 0 0 1-10 0c0-2.4 1.4-3.8 2.5-5 .2 1.5.9 2.4 1.8 2.8-.3-2.9 0-5.6.7-7.8z" />
      <path d="M12 18.2a2 2 0 0 1-2-2.1c0-1.2.9-1.9 1.4-2.6.5 1.2 2.6 1.6 2.6 2.7a2 2 0 0 1-2 2z" />
    </>
  ),
  book: (
    <>
      <path d="M3.8 5.6c2.8-1 5.5-.7 8.2 1v12.2c-2.7-1.7-5.4-2-8.2-1z" />
      <path d="M20.2 5.6c-2.8-1-5.5-.7-8.2 1v12.2c2.7-1.7 5.4-2 8.2-1z" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.8 4h8.4v5.2a4.2 4.2 0 0 1-8.4 0z" />
      <path d="M7.8 6H5.2a2.6 2.6 0 0 0 2.9 4.1M16.2 6h2.6a2.6 2.6 0 0 1-2.9 4.1" />
      <path d="M12 13.4v3.4M8.6 20h6.8M9.6 16.8h4.8V20H9.6z" />
    </>
  ),
  medal: (
    <>
      <path d="M8 3l3.2 6.4M16 3l-3.2 6.4" />
      <circle cx="12" cy="15" r="5.2" />
      <path d="M12 12.4l.85 1.75 1.9.27-1.38 1.34.33 1.9L12 16.75l-1.7.91.33-1.9-1.38-1.34 1.9-.27z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c3 2.1 4.4 5.6 3.9 10.2L14 15h-4l-1.9-1.8C7.6 8.6 9 5.1 12 3z" />
      <circle cx="12" cy="9" r="1.6" />
      <path d="M8.2 12.6l-2.6 2.6 2.4 2.6M15.8 12.6l2.6 2.6-2.4 2.6M10.8 17.6L12 21l1.2-3.4" />
    </>
  ),
  bolt: <path d="M13.2 2.8L5.6 13.4h5.6l-1 7.8 8.2-10.9h-5.6z" />,
  crown: (
    <>
      <path d="M4 8.2l4.1 3.9L12 5.6l3.9 6.5L20 8.2 18.4 17H5.6z" />
      <path d="M6 20.2h12" />
    </>
  ),
  check: (
    <>
      <path d="M12 3l7 2.9v5.3c0 4.5-3 7.9-7 9.8-4-1.9-7-5.3-7-9.8V5.9z" />
      <path d="M8.6 12.1l2.5 2.5 4.4-4.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.8" y="5.2" width="16.4" height="15" rx="2.4" />
      <path d="M3.8 9.6h16.4M8.4 3v4.2M15.6 3v4.2" />
      <path d="M9 14.6l2 2 4-4.2" />
    </>
  ),
  leaf: (
    <>
      <path d="M4.8 19.2c0-8.1 5-13.3 14.4-14.4-1 9.4-6.3 14.4-14.4 14.4z" />
      <path d="M4.8 19.2l8.4-8.4" />
    </>
  ),
};

export type BadgeIconState = "earned" | "new" | "locked";

export function BadgeIcon({
  icon,
  size = 48,
  state = "earned",
  label,
}: {
  icon: string;
  size?: number;
  state?: BadgeIconState;
  /** Accessible name; omit when the badge name is printed next to it. */
  label?: string;
}) {
  const key: BadgeIconKey = isBadgeIcon(icon) ? icon : "star";
  const lit = state !== "locked";
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className="shrink-0"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {state === "new" && <circle cx="24" cy="24" r="22.6" fill="none" className="stroke-gold" strokeWidth="2" />}
      <circle cx="24" cy="24" r="19.5" className={lit ? "fill-brand" : "fill-canvas stroke-line"} strokeWidth={lit ? 0 : 1.5} />
      <circle cx="24" cy="24" r="16.6" fill="none" className={lit ? "stroke-brand-deep" : "stroke-line"} strokeWidth="1" strokeDasharray="2 2.4" />
      <g
        transform="translate(12 12)"
        className={lit ? "text-canvas" : "text-faint"}
        stroke="currentColor"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[key]}
      </g>
    </svg>
  );
}

/** A radio group of every built-in icon, for the badge forms. Works without JavaScript. */
export function IconPicker({ name = "icon", defaultValue = "star" }: { name?: string; defaultValue?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[13px] font-medium">Icon</legend>
      <div className="grid grid-cols-6 gap-1.5">
        {(Object.keys(BADGE_ICON_LABELS) as BadgeIconKey[]).map((k) => (
          <label key={k} className="cursor-pointer" title={BADGE_ICON_LABELS[k]}>
            <input type="radio" name={name} value={k} defaultChecked={k === defaultValue} className="peer sr-only" />
            <span className="flex items-center justify-center rounded-xl border border-transparent p-1 transition peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:ring-2 peer-focus-visible:ring-gold hover:bg-canvas">
              <BadgeIcon icon={k} size={36} label={BADGE_ICON_LABELS[k]} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
