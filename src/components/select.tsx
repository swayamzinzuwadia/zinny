"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Popup, useFormValue, useSyncField } from "./popup";
import { cx, inputClass } from "./ui";

type Option = { value: string; label: string; disabled: boolean; group?: string };

/** Lists longer than this get a search box. */
const SEARCH_FROM = 8;

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return "";
}

/** Reads the <option> and <optgroup> children, so every page writes a select the normal way. */
function readOptions(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement(child)) return [];
    const props = child.props as { value?: unknown; label?: string; disabled?: boolean; children?: ReactNode };
    if (child.type === "option") {
      const label = textOf(props.children);
      return [{ value: String(props.value ?? label), label, disabled: !!props.disabled, group }];
    }
    if (child.type === "optgroup") return readOptions(props.children, props.label);
    if (child.type === Fragment) return readOptions(props.children, group);
    return [];
  });
}

const SIZING = ["w-", "h-", "rounded-", "text-["];

/** The field look, minus whatever size or shape the page sets itself: both can't win. */
function fieldClass(own = "") {
  const mine = own.split(/\s+/);
  const set = (c: string) => SIZING.find((g) => c.startsWith(g) && mine.some((m) => m.startsWith(g)));
  return inputClass
    .split(" ")
    .filter((c) => !set(c))
    .join(" ");
}

/**
 * Zinny's dropdown. It takes the same props and <option> children as a <select>, and a real
 * <select> stays hidden behind it, so form posts, `required` and onChange work unchanged.
 * `plain` drops Zinny's colours, for an institute's public site, which brings its own.
 */
export function Select({
  children,
  className,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  name,
  form,
  id,
  plain,
  "aria-label": ariaLabel,
  ...rest
}: ComponentProps<"select"> & { plain?: boolean }) {
  const options = useMemo(() => readOptions(children), [children]);
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const firstOpen = options.find((o) => !o.disabled)?.value ?? "";
  const [own, setOwn, resets] = useFormValue(native, defaultValue === undefined ? firstOpen : String(defaultValue));
  const wanted = value === undefined ? own : String(value);
  const selected = options.find((o) => o.value === wanted) ?? options.find((o) => !o.disabled) ?? options[0];
  const current = selected?.value ?? "";
  useSyncField(native, current, resets);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // A disabled option with no value is the "Choose one" prompt, not something to list.
  const choices = useMemo(() => options.filter((o) => o.value !== "" || !o.disabled), [options]);
  const searchable = choices.length > SEARCH_FROM;
  const needle = query.trim().toLowerCase();
  const shown = needle ? choices.filter((o) => `${o.label} ${o.group ?? ""}`.toLowerCase().includes(needle)) : choices;

  function show() {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, choices.findIndex((o) => o.value === current)));
    setOpen(true);
  }

  const hide = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  function pick(o: Option | undefined) {
    if (!o || o.disabled) return;
    hide(true);
    const el = native.current;
    if (!el || o.value === current) return;
    el.value = o.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function step(from: number, by: 1 | -1) {
    for (let i = from + by; i >= 0 && i < shown.length; i += by) if (!shown[i].disabled) return i;
    return from;
  }

  function jumpTo(key: string) {
    const now = Date.now();
    const text = (now - typed.current.at > 600 ? "" : typed.current.text) + key.toLowerCase();
    typed.current = { text, at: now };
    const hit = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
    if (hit >= 0) setActive(hit);
  }

  function onListKey(e: KeyboardEvent) {
    const typing = searchable && e.target === search.current;
    if (e.key === "ArrowDown") setActive((a) => step(a, 1));
    else if (e.key === "ArrowUp") setActive((a) => step(a, -1));
    else if (e.key === "Home" && !typing) setActive(step(-1, 1));
    else if (e.key === "End" && !typing) setActive(step(shown.length, -1));
    else if (e.key === "Enter" || (e.key === " " && !typing)) pick(shown[active]);
    else if (e.key === "Tab") hide(true);
    else {
      if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey) jumpTo(e.key);
      return;
    }
    e.preventDefault();
  }

  useEffect(() => {
    if (!open) return;
    if (searchable && window.matchMedia("(pointer: fine)").matches) search.current?.focus();
    else list.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (open) list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [open, active, query]);

  const prompt = !selected || (selected.disabled && selected.value === "");

  return (
    <>
      <button
        {...(rest as ComponentProps<"button">)}
        ref={trigger}
        type="button"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            show();
          }
        }}
        className={cx(
          !plain && fieldClass(className),
          "flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
          !plain && open && "border-brand ring-4 ring-gold-soft",
          prompt && "text-faint",
          className,
        )}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={cx("size-3.5 shrink-0 text-muted [transition-property:transform] duration-150", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 6 8 10.5 12.5 6" />
        </svg>
      </button>
      <select
        ref={native}
        aria-hidden
        tabIndex={-1}
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        value={current}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => {
          setOwn(e.target.value);
          onChange?.(e);
        }}
        // An invalid form sends focus here; the visible control is the one to focus.
        onFocus={() => trigger.current?.focus()}
        className="sr-only"
      >
        {children}
      </select>
      {open && (
        <Popup anchor={trigger} onClose={hide} matchWidth className="flex w-max max-w-[min(24rem,calc(100vw-16px))] flex-col overflow-hidden">
          <div onKeyDown={onListKey} className="flex min-h-0 flex-col">
            {searchable && (
              <div className="border-b border-line p-1.5">
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search"
                  aria-label="Search this list"
                  aria-controls={listId}
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                  className="h-9 w-full rounded-xl bg-canvas px-3 text-[14px] outline-none placeholder:text-faint"
                />
              </div>
            )}
            <ul
              ref={list}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="pick-scroll max-h-72 min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none"
            >
              {shown.length === 0 && <li className="px-3 py-2 text-[14px] text-muted">Nothing matches</li>}
              {shown.map((o, i) => (
                <Fragment key={`${o.group ?? ""}:${o.value}`}>
                  {o.group && o.group !== shown[i - 1]?.group && (
                    <li role="presentation" className="px-3 pt-2 pb-1 text-[12px] text-muted">
                      {o.group}
                    </li>
                  )}
                  <li
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={o.value === current}
                    aria-disabled={o.disabled || undefined}
                    data-active={i === active || undefined}
                    onPointerMove={() => !o.disabled && setActive(i)}
                    onClick={() => pick(o)}
                    className={cx(
                      "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[14px] leading-snug",
                      o.disabled ? "cursor-not-allowed text-faint" : "cursor-pointer",
                      i === active && !o.disabled && (plain ? "bg-canvas" : "bg-brand-soft"),
                      o.value === current && (plain ? "font-medium" : "font-medium text-brand-strong"),
                    )}
                  >
                    <span className="min-w-0">{o.label}</span>
                    {o.value === current && (
                      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                      </svg>
                    )}
                  </li>
                </Fragment>
              ))}
            </ul>
          </div>
        </Popup>
      )}
    </>
  );
}
