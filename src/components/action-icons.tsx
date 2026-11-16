import type { ReactNode } from "react";

/**
 * Icons for actions (Edit, Archive, Delete, Download, Open…). One stroke style, 16 px,
 * coloured by the text around them. Buttons pick their icon from their label, so
 * "Archive plan" gets the archive box without anyone passing it.
 */

const PATHS = {
  edit: (
    <>
      <path d="M11.3 2.7a1.6 1.6 0 0 1 2.3 2.3L6 12.6l-3 .7.7-3z" />
      <path d="m10 4 2 2" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="2.8" width="12" height="3.2" rx="0.8" />
      <path d="M3.2 6v6.4c0 .6.4 1 1 1h7.6c.6 0 1-.4 1-1V6" />
      <path d="M6.5 8.7h3" />
    </>
  ),
  restore: (
    <>
      <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8" />
      <path d="M2.6 2.6v2.8h2.8" />
    </>
  ),
  delete: (
    <>
      <path d="M2.8 4.3h10.4" />
      <path d="M6.2 4.3V3c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.3" />
      <path d="M4 4.3l.6 8.5c0 .6.5 1 1 1h4.8c.5 0 1-.4 1-1l.6-8.5" />
      <path d="M6.8 7v4M9.2 7v4" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.5v7.5" />
      <path d="m5 7.2 3 3 3-3" />
      <path d="M2.8 11v1.4c0 .6.5 1.1 1.1 1.1h8.2c.6 0 1.1-.5 1.1-1.1V11" />
    </>
  ),
  upload: (
    <>
      <path d="M8 10.5V3" />
      <path d="m5 5.8 3-3 3 3" />
      <path d="M2.8 11v1.4c0 .6.5 1.1 1.1 1.1h8.2c.6 0 1.1-.5 1.1-1.1V11" />
    </>
  ),
  open: (
    <>
      <path d="M6 3.2H4.1c-.6 0-1.1.5-1.1 1.1v7.6c0 .6.5 1.1 1.1 1.1h7.6c.6 0 1.1-.5 1.1-1.1V10" />
      <path d="M9 3h4v4" />
      <path d="M13 3 7.5 8.5" />
    </>
  ),
  view: (
    <>
      <path d="M1.8 8S4 3.6 8 3.6 14.2 8 14.2 8 12 12.4 8 12.4 1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  hide: (
    <>
      <path d="M6.6 3.8A6 6 0 0 1 8 3.6c4 0 6.2 4.4 6.2 4.4a10 10 0 0 1-1.6 2.2M10.5 11.7A5.6 5.6 0 0 1 8 12.4C4 12.4 1.8 8 1.8 8a10.6 10.6 0 0 1 2.4-2.9" />
      <path d="m2.5 2.5 11 11" />
    </>
  ),
  add: <path d="M8 3v10M3 8h10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  send: (
    <>
      <path d="M13.8 2.2 7 9" />
      <path d="m13.8 2.2-4.3 11.6L7 9 2.2 6.5z" />
    </>
  ),
  resend: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" />
      <path d="M13.4 2.6v2.8h-2.8" />
    </>
  ),
  print: (
    <>
      <path d="M4.5 6V2.5h7V6" />
      <rect x="2.3" y="6" width="11.4" height="5" rx="1" />
      <path d="M4.5 9.5h7v4h-7z" />
    </>
  ),
  settings: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
  key: (
    <>
      <circle cx="5.3" cy="10.7" r="2.6" />
      <path d="m7.2 8.8 6-6M11.3 4.7l1.6 1.6M9.6 6.4l1.2 1.2" />
    </>
  ),
  play: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.7 5.7v4.6L10.3 8z" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" />
      <path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" />
    </>
  ),
  check: <path d="m3 8.4 3.2 3.1L13 4.6" />,
  back: (
    <>
      <path d="M13 8H3.5" />
      <path d="M7.2 4.3 3.5 8l3.7 3.7" />
    </>
  ),
  forward: (
    <>
      <path d="M3 8h9.5" />
      <path d="m8.8 4.3 3.7 3.7-3.7 3.7" />
    </>
  ),
  move: (
    <>
      <path d="M2.5 5.5h9.5M9.5 3l2.5 2.5L9.5 8" />
      <path d="M13.5 10.5H4M6.5 8 4 10.5 6.5 13" />
    </>
  ),
  money: (
    <>
      <path d="M4 3h8M4 6h8M6.5 3c2.4 0 3.4 1.2 3.4 3s-1.2 3-3.4 3H4.3l5 4" />
    </>
  ),
  support: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <circle cx="8" cy="8" r="2.4" />
      <path d="m3.9 3.9 2.4 2.4M9.7 9.7l2.4 2.4M12.1 3.9 9.7 6.3M6.3 9.7l-2.4 2.4" />
    </>
  ),
  signOut: (
    <>
      <path d="M6 13.5H3.9c-.6 0-1.1-.5-1.1-1.1V3.6c0-.6.5-1.1 1.1-1.1H6" />
      <path d="M10.5 11 13.5 8l-3-3M13.5 8H6.2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type ActionIconName = keyof typeof PATHS;

export function ActionIcon({ name, className }: { name: ActionIconName; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-4 shrink-0"}
    >
      {PATHS[name]}
    </svg>
  );
}

/** First word of a label → its icon. Labels that don't start with an action verb get none. */
const BY_VERB: [RegExp, ActionIconName][] = [
  [/^(edit|rename|change|update|revise|customise|customize)\b/i, "edit"],
  [/^(archive)\b/i, "archive"],
  [/^(restore|unarchive|undo|reactivate)\b/i, "restore"],
  [/^(delete|remove|revoke|discard)\b/i, "delete"],
  [/^(download|export)\b/i, "download"],
  [/^(upload|import)\b/i, "upload"],
  [/^(back to|previous)\b/i, "back"],
  [/^(go to|next|continue)\b/i, "forward"],
  [/^(send refund)\b/i, "money"],
  [/^(send back)\b/i, "resend"],
  [/^(open|visit)\b/i, "forward"],
  [/^(view|see|preview|show)\b/i, "view"],
  [/^(add|create|new|invite)\b/i, "add"],
  [/^(cancel|clear|close|dismiss|reject|decline)\b/i, "close"],
  [/^(send|publish|share|submit)\b/i, "send"],
  [/^(resend|retry|reset|refresh|renew)\b/i, "resend"],
  [/^(print)\b/i, "print"],
  [/^(manage|settings|configure)\b/i, "settings"],
  [/^(set .*password|set password)\b/i, "key"],
  [/^(watch|play|join)\b/i, "play"],
  [/^(copy|duplicate)\b/i, "copy"],
  [/^(approve|accept|mark|confirm|verify|grade)\b/i, "check"],
  [/^(move|switch|transfer)\b/i, "move"],
  [/^(refund|record payment|pay)\b/i, "money"],
  [/^(sign out|log out)\b/i, "signOut"],
  [/^(enter support|support mode)\b/i, "support"],
  [/^(hide)\b/i, "hide"],
];

export function iconFor(label: ReactNode): ActionIconName | null {
  if (typeof label !== "string") return null;
  const text = label.trim();
  for (const [re, name] of BY_VERB) if (re.test(text)) return name;
  return null;
}

/** Actions that destroy something are shown in red. */
export const isDestructive = (label: ReactNode) => typeof label === "string" && /^(delete|remove|revoke|discard)\b/i.test(label.trim());
