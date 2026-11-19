"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./combobox.css";
import { cx } from "./ui";

/**
 * A search box with a live list of matches under it (the ARIA combobox pattern).
 * Typing asks `search` for matches after a short pause; the arrow keys move through them,
 * Enter picks one, Escape closes the list. Matches already fetched are kept, so deleting a
 * letter shows the earlier list at once. The list opens downward from the box.
 */
export function Combobox<T>({
  label,
  placeholder,
  initialValue = "",
  search,
  itemKey,
  renderItem,
  onChoose,
  onSubmit,
  submitLabel,
  onClear,
  emptyText,
  hotkey,
  debounceMs = 140,
  className,
  size = "md",
}: {
  label: string;
  placeholder?: string;
  initialValue?: string;
  search: (query: string, signal: AbortSignal) => Promise<T[]>;
  itemKey: (item: T) => string;
  renderItem: (item: T, query: string) => ReactNode;
  onChoose: (item: T, query: string) => void;
  /** Enter with nothing highlighted, or the last row of the list. */
  onSubmit?: (query: string) => void;
  submitLabel?: (query: string) => ReactNode;
  /** The box was emptied (by typing or the clear button). */
  onClear?: () => void;
  emptyText?: (query: string) => string;
  /** Press this key anywhere on the page to jump into the box. */
  hotkey?: string;
  debounceMs?: number;
  className?: string;
  size?: "md" | "sm";
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState(initialValue);
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, T[]>());
  const searchRef = useRef(search);
  searchRef.current = search;

  const term = q.trim();
  const hasSubmit = !!onSubmit && !!term;
  const rows = items.length + (hasSubmit && items.length ? 1 : 0);

  // Fetch after a pause. Typing again cancels the request still in flight.
  useEffect(() => {
    if (!term) {
      setItems([]);
      setLoading(false);
      setSettled("");
      return;
    }
    const cached = cache.current.get(term.toLowerCase());
    if (cached) {
      setItems(cached);
      setSettled(term);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = await searchRef.current(term, ctl.signal);
        cache.current.set(term.toLowerCase(), found);
        setItems(found);
        setSettled(term);
        setActive(-1);
      } catch {
        // Aborted by the next keystroke, or the network dropped: keep what is showing.
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [term, debounceMs]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const combo = hotkey === "k" ? (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" : !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === hotkey;
      if (!combo) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  const choose = useCallback(
    (i: number) => {
      if (i < items.length) {
        onChoose(items[i], term);
        setOpen(false);
      } else if (onSubmit) {
        onSubmit(term);
        setOpen(false);
      }
    },
    [items, onChoose, onSubmit, term],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (!rows) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + rows + (a === -1 && step === -1 ? 1 : 0)) % rows);
    } else if (e.key === "Enter") {
      if (open && active >= 0 && active < rows) {
        e.preventDefault();
        choose(active);
      } else if (onSubmit) {
        e.preventDefault();
        onSubmit(term);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (q) {
        setQ("");
        onClear?.();
      }
    } else if (e.key === "Home" && open && rows) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open && rows) {
      e.preventDefault();
      setActive(rows - 1);
    }
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, uid]);

  const showList = open && !!term;
  const none = showList && !loading && settled === term && items.length === 0;

  return (
    <div className={cx("relative", className)}>
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3.5 3.5" />
      </svg>
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={showList && (items.length > 0 || none)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          setOpen(true);
          setActive(-1);
          if (!v.trim()) onClear?.();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cx(
          "w-full rounded-full border border-line bg-surface pr-16 pl-10 text-[14px] text-ink outline-none [transition-property:border-color,box-shadow] duration-150 placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-gold-soft",
          size === "sm" ? "h-9" : "h-10",
        )}
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
        {loading && <span aria-hidden className="cbx-spin size-3.5 rounded-full border-2 border-line border-t-brand" />}
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ("");
              setOpen(false);
              onClear?.();
              input.current?.focus();
            }}
            className="grid size-6 place-items-center rounded-full text-faint [transition-property:background-color,color] duration-150 hover:bg-canvas hover:text-ink"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m4 4 8 8M12 4 4 12" />
            </svg>
          </button>
        )}
        {!q && hotkey && (
          <kbd aria-hidden className="hidden rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-faint sm:block">
            {hotkey === "k" ? "Ctrl K" : hotkey}
          </kbd>
        )}
      </div>

      {showList && (items.length > 0 || none) && (
        <div className="cbx-pop absolute top-[calc(100%+6px)] right-0 left-0 z-40 origin-top overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.18)]">
          <ul id={listId} role="listbox" aria-label={label} className="max-h-[min(360px,60dvh)] overflow-y-auto p-1.5" onMouseDown={(e) => e.preventDefault()}>
            {items.map((item, i) => (
              <li
                key={itemKey(item)}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={active === i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cx("cursor-pointer rounded-xl px-3 py-2 [transition-property:background-color] duration-100", active === i ? "bg-brand-soft" : "")}
              >
                {renderItem(item, term)}
              </li>
            ))}
            {hasSubmit && items.length > 0 && (
              <li
                id={`${uid}-opt-${items.length}`}
                role="option"
                aria-selected={active === items.length}
                onMouseEnter={() => setActive(items.length)}
                onClick={() => choose(items.length)}
                className={cx(
                  "mt-1 cursor-pointer rounded-xl border-t border-line px-3 py-2 text-[13px] text-muted [transition-property:background-color] duration-100",
                  active === items.length && "bg-brand-soft text-ink",
                )}
              >
                {submitLabel ? submitLabel(term) : `Search for “${term}”`}
              </li>
            )}
            {none && <li className="px-3 py-3 text-[14px] text-muted">{emptyText ? emptyText(term) : `Nothing matches “${term}”.`}</li>}
          </ul>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {showList && settled === term ? (items.length ? `${items.length} matches` : "No matches") : ""}
      </span>
    </div>
  );
}

/** Wraps the matching letters in bold, for a result line. */
export function Highlight({ parts }: { parts: { text: string; hit: boolean }[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-transparent font-semibold text-brand-strong underline decoration-gold decoration-2 underline-offset-[3px]">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
