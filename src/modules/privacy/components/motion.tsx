"use client";

import { useId, useState, type ReactNode } from "react";
import { ActionIcon, buttonClass, cx, type ActionIconName, type ButtonVariant } from "@/components/ui";
import "./privacy.css";

/** Opens and closes its children by growing their height, so nothing pops in. */
export function Grow({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="dp-grow" data-open={open} aria-hidden={!open} inert={!open}>
      <div>
        <div className="dp-panel">{children}</div>
      </div>
    </div>
  );
}

/** A button that unfolds a panel right under it, and folds it back. */
export function Disclosure({
  label,
  openLabel,
  icon,
  variant = "secondary",
  size = "md",
  defaultOpen = false,
  children,
}: {
  label: string;
  openLabel?: string;
  icon?: ActionIconName;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={buttonClass(variant, size)}>
        <ActionIcon name={open ? "close" : (icon ?? "add")} />
        {open ? (openLabel ?? "Close") : label}
      </button>
      <div id={id} className={cx("mt-3")}>
        <Grow open={open}>{children}</Grow>
      </div>
    </div>
  );
}
