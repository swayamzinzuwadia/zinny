"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

const EDGE = 8;
const GAP = 6;

/**
 * A floating panel pinned to the control that opened it. It is drawn on the page body, so
 * no card, table or sidebar can clip it, and it opens upward when there's no room below.
 * `onClose(true)` means the keyboard closed it, so focus should go back to the control.
 */
export function Popup({
  anchor,
  onClose,
  matchWidth,
  className,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: (refocus: boolean) => void;
  matchWidth?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // See-through, not hidden, until it is measured: a hidden panel can't take keyboard focus.
  const [place, setPlace] = useState<CSSProperties>({ top: 0, left: 0, opacity: 0 });

  useLayoutEffect(() => {
    const put = (e?: Event) => {
      const a = anchor.current?.getBoundingClientRect();
      const el = panel.current;
      if (!a || !el || (e?.target instanceof Node && el.contains(e.target))) return;
      const wide = document.documentElement.clientWidth;
      const tall = window.innerHeight;
      const below = tall - a.bottom - GAP - EDGE;
      const above = a.top - GAP - EDGE;
      const height = el.scrollHeight + 2;
      const up = height > below && above > below;
      const room = up ? above : below;
      // Too tall for either side: cover the control rather than scroll the panel's own buttons away.
      const over = height > room && height <= tall - EDGE * 2;
      setPlace({
        left: Math.max(EDGE, Math.min(a.left, wide - el.offsetWidth - EDGE)),
        ...(over
          ? { top: tall - height - EDGE, transformOrigin: "bottom" }
          : up
            ? { bottom: tall - a.top + GAP, transformOrigin: "bottom" }
            : { top: a.bottom + GAP, transformOrigin: "top" }),
        maxHeight: over ? height : room,
        ...(matchWidth ? { minWidth: a.width } : {}),
      });
    };
    put();
    window.addEventListener("resize", put);
    window.addEventListener("scroll", put, true);
    return () => {
      window.removeEventListener("resize", put);
      window.removeEventListener("scroll", put, true);
    };
  }, [anchor, matchWidth]);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      const a = anchor.current;
      if (panel.current?.contains(t) || a?.contains(t)) return;
      // The control's own label toggles it with the click that follows.
      if (t instanceof Element && a && t.closest("label")?.contains(a)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchor, onClose]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose(true);
    }
    // Keep Tab inside the panel: it sits at the end of the page, far from its control.
    if (e.key === "Tab" && panel.current) {
      const stops = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), input")].filter((b) => b.tabIndex >= 0);
      if (stops.length === 0) return;
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    }
  }

  return createPortal(
    <div
      ref={panel}
      onKeyDown={onKeyDown}
      style={place}
      className={cx("pop-in fixed z-[70] rounded-2xl border border-line bg-surface shadow-[0_12px_40px_rgb(6_58_47/0.16)]", className)}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * The value of a custom control that sits on a hidden native field. Forms, validation and
 * change events all keep working through that field; this follows the form when it resets.
 * Pair it with useSyncField, passing the third value it returns.
 */
export function useFormValue(field: RefObject<HTMLInputElement | HTMLSelectElement | null>, start: string) {
  const [value, setValue] = useState(start);
  const [resets, setResets] = useState(0);
  useEffect(() => {
    const form = field.current?.form;
    if (!form) return;
    const back = () => {
      setValue(start);
      setResets((n) => n + 1);
    };
    form.addEventListener("reset", back);
    return () => form.removeEventListener("reset", back);
  }, [field, start]);
  return [value, setValue, resets] as const;
}

/** A form reset moves the hidden field on its own; this puts it back on the shown value. */
export function useSyncField(field: RefObject<HTMLInputElement | HTMLSelectElement | null>, value: string, resets: number) {
  useLayoutEffect(() => {
    if (field.current && field.current.value !== value) field.current.value = value;
  }, [field, value, resets]);
}
