"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ActionIcon, type ActionIconName } from "./action-icons";
import { ButtonLabel, buttonClass, cx, type ButtonVariant } from "./ui";

/*
 * A form that waits behind its button. List pages used to keep their "Add" form open beside
 * the list at all times; now the page shows the list, and the form unfolds under the page
 * header when its button is pressed, and folds back when it is closed.
 *
 *   <Panels>
 *     <PageHeader actions={<PanelButton panel="add">Add person</PanelButton>} />
 *     <Panel id="add" title="Add a person">…the form…</Panel>
 *     …the list…
 *   </Panels>
 *
 * One panel is open at a time. Escape closes it and gives focus back to its button.
 */

type Ctx = {
  open: string | null;
  uid: string;
  toggle: (id: string, from: HTMLElement | null) => void;
  close: (refocus: boolean) => void;
};
const PanelContext = createContext<Ctx | null>(null);

function usePanels(): Ctx {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error("PanelButton and Panel must be inside <Panels>.");
  return ctx;
}

/** `initial` opens one panel from the start, for a page that has nothing to list yet. */
export function Panels({ initial, children }: { initial?: string; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(initial ?? null);
  const uid = useId();
  const opener = useRef<HTMLElement | null>(null);
  const toggle = useCallback((id: string, from: HTMLElement | null) => {
    opener.current = from;
    setOpen((now) => (now === id ? null : id));
  }, []);
  const close = useCallback((refocus: boolean) => {
    setOpen(null);
    if (refocus) opener.current?.focus();
  }, []);
  const value = useMemo(() => ({ open, uid, toggle, close }), [open, uid, toggle, close]);
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

/** The button that opens (and closes) a panel. The icon comes from the label's first word, as on every button. */
export function PanelButton({
  panel,
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
}: {
  panel: string;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: ActionIconName | false;
  className?: string;
  children: ReactNode;
}) {
  const { open, uid, toggle } = usePanels();
  return (
    <button
      type="button"
      aria-expanded={open === panel}
      aria-controls={`${uid}-${panel}`}
      onClick={(e) => toggle(panel, e.currentTarget)}
      className={cx(buttonClass(variant, size), "whitespace-nowrap", className)}
    >
      <ButtonLabel icon={icon}>{children}</ButtonLabel>
    </button>
  );
}

export function Panel({ id, title, hint, className, children }: { id: string; title: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  const { open, uid, close } = usePanels();
  const shown = open === id;
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // Opened by its button: bring it into view and put the cursor in its first field.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!shown) return;
    const el = box.current;
    el?.scrollIntoView({ block: "nearest" });
    el?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus({ preventScroll: true });
  }, [shown]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.stopPropagation();
      close(true);
    }
  }

  return (
    // Grid rows animate from 0fr to 1fr, so the panel unfolds from under its button to its natural height.
    <div
      id={`${uid}-${id}`}
      role="region"
      aria-label={title}
      onTransitionEnd={(e) => e.target === e.currentTarget && shown && box.current?.scrollIntoView({ block: "nearest" })}
      className={cx(
        "grid [transition-property:grid-template-rows,opacity,margin-bottom] duration-200 ease-out motion-reduce:transition-none",
        shown ? "mb-6 grid-rows-[1fr] opacity-100" : "mb-0 grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden" inert={!shown}>
        <div ref={box} onKeyDown={onKeyDown} className={cx("rounded-2xl border border-brand/30 bg-surface p-5", className)}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[16px] font-medium">{title}</h2>
              {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
            </div>
            <button type="button" onClick={() => close(true)} className={buttonClass("quiet", "sm")}>
              <ActionIcon name="close" />
              Close
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
