"use client";

import { useId, useState, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * One row of a people list: what you read (`children`), a single "Manage" link on the right and,
 * when it is open, the row's actions on their own line under it. With no `panel` there is
 * nothing to manage and no link. The panel stays mounted while closed so typed values survive.
 */
export function ManageRow({ children, panel, label, lead }: { children: ReactNode; panel?: ReactNode; label: string; lead?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={cx("px-4 py-3", open && "bg-canvas/60")}>
      <div className="flex items-start gap-3">
        {lead !== undefined && <div className="flex h-6 w-5 shrink-0 items-center">{lead}</div>}
        <div className="min-w-0 flex-1">{children}</div>
        {panel && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            aria-label={`Manage ${label}`}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 py-0.5 text-[13px] font-medium text-brand hover:underline"
          >
            {open ? "Close" : "Manage"}
          </button>
        )}
      </div>
      {panel && (
        <div id={id} hidden={!open} className={cx("mt-3 border-t border-line pt-3", lead !== undefined && "sm:ml-8")}>
          {panel}
        </div>
      )}
    </li>
  );
}
