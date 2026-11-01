"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { MONTHS, WEEKDAYS, addDays, addMonths, clockValue, deviceToday, longDay, minuteSteps, monthCells, parseClock, parseDay, showClock, showDay, startOfWeek, ymd } from "./calendar";
import { Popup, useFormValue, useSyncField } from "./popup";
import { buttonClass, cx, inputClass } from "./ui";

/*
 * Zinny's date and time pickers. Each keeps a real <input type="date|time|datetime-local">
 * hidden behind it, so form posts, `required`, `min`, `max` and onChange work as before.
 * <Input type="date"> in ui.tsx renders these, so pages don't need to know about them.
 */

type NativeProps = ComponentProps<"input">;
type Panel = { value: string; commit: (next: string) => void; close: (refocus: boolean) => void };

const ICONS = {
  date: <path d="M3.5 5h13v11.5h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5" />,
  time: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 6v4.2l2.8 1.8" />,
};

function PickerField({
  icon,
  text,
  placeholder,
  panel,
  className,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
  id,
  name,
  form,
  min,
  max,
  type,
  "aria-label": ariaLabel,
  ...rest
}: NativeProps & { icon: keyof typeof ICONS; text: (value: string) => string; placeholder: string; panel: (p: Panel) => ReactNode }) {
  const native = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [own, setOwn, resets] = useFormValue(native, String(defaultValue ?? ""));
  const current = value === undefined ? own : String(value);
  useSyncField(native, current, resets);
  const [open, setOpen] = useState(false);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  function commit(next: string) {
    const el = native.current;
    if (!el || next === current) return;
    // React only notices a change made through the input's own value setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const shown = text(current);

  return (
    <>
      <button
        {...(rest as ComponentProps<"button">)}
        ref={trigger}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(
          inputClass,
          "flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
          open && "border-brand ring-4 ring-gold-soft",
          !shown && "text-faint",
          className,
        )}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[icon]}
        </svg>
        <span className="tabular min-w-0 truncate">{shown || placeholder}</span>
      </button>
      <input
        ref={native}
        aria-hidden
        tabIndex={-1}
        type={type}
        name={name}
        form={form}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        value={current}
        onChange={(e) => {
          setOwn(e.target.value);
          onChange?.(e);
        }}
        // An invalid form sends focus here; the visible control is the one to focus.
        onFocus={() => trigger.current?.focus()}
        className="sr-only"
      />
      {open && (
        <Popup anchor={trigger} onClose={close} className="pick-scroll overflow-y-auto">
          {panel({ value: current, commit, close })}
        </Popup>
      )}
    </>
  );
}

const footerButton = "h-8 rounded-full px-3 text-[13px] font-medium text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent";

function Arrow({ label, flip, onClick }: { label: string; flip?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-brand-soft hover:text-ink">
      <svg aria-hidden viewBox="0 0 16 16" className={cx("size-3.5", flip && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
    </button>
  );
}

/** One month to pick a day from. The month name opens a grid of months, to jump a long way. */
function Calendar({ value, min, max, autoFocus, onPick }: { value: string; min?: string; max?: string; autoFocus: boolean; onPick: (day: string) => void }) {
  const today = deviceToday();
  const [cursor, setCursor] = useState(value || today);
  const [choosingMonth, setChoosingMonth] = useState(false);
  const focusCursor = useRef(autoFocus);
  const grid = useRef<HTMLDivElement>(null);
  const at = parseDay(cursor) ?? parseDay(today)!;

  const off = (day: string) => (!!min && day < min) || (!!max && day > max);

  useEffect(() => {
    if (!focusCursor.current) return;
    focusCursor.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
  }, [cursor, choosingMonth]);

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, -1),
      PageDown: () => addMonths(cursor, 1),
      Home: () => startOfWeek(cursor),
      End: () => addDays(startOfWeek(cursor), 6),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    focusCursor.current = true;
    setCursor(move());
  }

  if (choosingMonth) {
    return (
      <div className="w-[292px]">
        <div className="mb-2 flex items-center justify-between">
          <Arrow label="Previous year" flip onClick={() => setCursor(addMonths(cursor, -12))} />
          <span className="tabular text-[14px] font-medium">{at.year}</span>
          <Arrow label="Next year" onClick={() => setCursor(addMonths(cursor, 12))} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setCursor(ymd(at.year, i, 1));
                setChoosingMonth(false);
              }}
              className={cx("h-11 rounded-xl text-[14px]", i === at.month ? "bg-brand font-medium text-canvas" : "hover:bg-brand-soft")}
            >
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[292px]">
      <div className="mb-1 flex items-center justify-between">
        <Arrow label="Previous month" flip onClick={() => setCursor(addMonths(cursor, -1))} />
        <button type="button" onClick={() => setChoosingMonth(true)} className="tabular h-9 rounded-full px-3 text-[14px] font-medium hover:bg-brand-soft">
          {MONTHS[at.month]} {at.year}
        </button>
        <Arrow label="Next month" onClick={() => setCursor(addMonths(cursor, 1))} />
      </div>
      <div aria-hidden className="grid grid-cols-7 text-center text-[12px] text-muted">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1.5">
            {d.slice(0, 2)}
          </span>
        ))}
      </div>
      <div ref={grid} onKeyDown={onKeyDown} className="grid grid-cols-7 justify-items-center gap-y-0.5">
        {monthCells(at.year, at.month).map((day, i) => {
          if (!day) return <span key={i} />;
          const closed = off(day);
          const picked = day === value;
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === cursor ? 0 : -1}
              aria-label={longDay(day)}
              aria-pressed={picked}
              aria-disabled={closed || undefined}
              aria-current={day === today ? "date" : undefined}
              onClick={() => !closed && onPick(day)}
              className={cx(
                "tabular relative flex size-10 items-center justify-center rounded-xl text-[14px]",
                picked ? "bg-brand font-medium text-canvas" : closed ? "cursor-not-allowed text-faint/60" : "hover:bg-brand-soft",
              )}
            >
              {parseDay(day)?.day}
              {day === today && <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-gold" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Column<T extends number | boolean>({
  label,
  items,
  selected,
  show,
  autoFocus,
  onPick,
}: {
  label: string;
  items: T[];
  selected: T | undefined;
  show: (item: T) => string;
  autoFocus?: boolean;
  onPick: (item: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const at = selected === undefined ? -1 : items.indexOf(selected);

  useEffect(() => {
    const el = list.current;
    const item = el?.querySelector<HTMLElement>("[aria-selected=true]") ?? el?.querySelector<HTMLElement>("button");
    if (!el || !item) return;
    el.scrollTop = item.offsetTop - el.clientHeight / 2 + item.offsetHeight / 2;
    if (autoFocus) item.focus({ preventScroll: true });
    // Only when the panel opens: scrolling under the pointer on every pick would be jumpy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const by = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(items.length - 1, at + by));
    onPick(items[next]);
    const el = list.current?.children[next] as HTMLElement | undefined;
    el?.focus();
  }

  return (
    <div className="w-[68px]">
      <div className="pb-1.5 text-center text-[12px] text-muted">{label}</div>
      <div ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown} className="relative h-[220px] space-y-0.5 overflow-y-auto overscroll-contain px-0.5 [scrollbar-width:none]">
        {items.map((item, i) => (
          <button
            key={String(item)}
            type="button"
            role="option"
            aria-selected={item === selected}
            tabIndex={i === Math.max(at, 0) ? 0 : -1}
            onClick={() => onPick(item)}
            className={cx("tabular h-9 w-full rounded-xl text-[14px]", item === selected ? "bg-brand font-medium text-canvas" : "hover:bg-brand-soft")}
          >
            {show(item)}
          </button>
        ))}
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
/** What a click starts from when no time is set yet. */
const START = { hour: 9, minute: 0, pm: false };

/** Hour, minute and AM or PM side by side. */
function TimeColumns({ value, autoFocus, onPick }: { value: string; autoFocus: boolean; onPick: (time: string) => void }) {
  const clock = parseClock(value);
  const from = clock ?? START;
  return (
    <div className="flex gap-1">
      <Column label="Hour" items={HOURS} selected={clock?.hour} show={String} autoFocus={autoFocus} onPick={(hour) => onPick(clockValue({ ...from, hour }))} />
      <Column label="Minute" items={minuteSteps(clock?.minute)} selected={clock?.minute} show={(m) => String(m).padStart(2, "0")} onPick={(minute) => onPick(clockValue({ ...from, minute }))} />
      <Column label="Period" items={[false, true]} selected={clock?.pm} show={(pm) => (pm ? "PM" : "AM")} onPick={(pm) => onPick(clockValue({ ...from, pm }))} />
    </div>
  );
}

export function DateField(props: NativeProps) {
  const min = props.min === undefined ? undefined : String(props.min);
  const max = props.max === undefined ? undefined : String(props.max);
  const today = deviceToday();
  return (
    <PickerField
      {...props}
      icon="date"
      text={showDay}
      placeholder="Pick a date"
      panel={({ value, commit, close }) => (
        <div className="p-3">
          <Calendar
            value={value}
            min={min}
            max={max}
            autoFocus
            onPick={(day) => {
              commit(day);
              close(true);
            }}
          />
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              disabled={(!!min && today < min) || (!!max && today > max)}
              onClick={() => {
                commit(today);
                close(true);
              }}
              className={footerButton}
            >
              Today
            </button>
            {!props.required && (
              <button
                type="button"
                disabled={!value}
                onClick={() => {
                  commit("");
                  close(true);
                }}
                className={footerButton}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    />
  );
}

export function TimeField(props: NativeProps) {
  return (
    <PickerField
      {...props}
      icon="time"
      text={showClock}
      placeholder="Pick a time"
      panel={({ value, commit, close }) => (
        <div className="p-3">
          <TimeColumns value={value} autoFocus onPick={commit} />
          <PanelEnd clearable={!props.required && !!value} onClear={() => commit("")} onDone={() => close(true)} />
        </div>
      )}
    />
  );
}

export function DateTimeField(props: NativeProps) {
  return (
    <PickerField
      {...props}
      icon="date"
      text={(v) => (v ? `${showDay(v)}, ${showClock(v.slice(11, 16))}` : "")}
      placeholder="Pick a date and time"
      panel={({ value, commit, close }) => {
        const day = value.slice(0, 10);
        const time = value.slice(11, 16);
        return (
          <div className="p-3">
            <div className="flex w-[min(520px,calc(100vw-42px))] flex-wrap justify-center gap-x-4 gap-y-3">
              <Calendar value={day} autoFocus onPick={(d) => commit(`${d}T${time || clockValue(START)}`)} />
              <TimeColumns value={time} autoFocus={false} onPick={(t) => commit(`${day || deviceToday()}T${t}`)} />
            </div>
            <PanelEnd clearable={!props.required && !!value} onClear={() => commit("")} onDone={() => close(true)} />
          </div>
        );
      }}
    />
  );
}

function PanelEnd({ clearable, onClear, onDone }: { clearable: boolean; onClear: () => void; onDone: () => void }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
      {clearable ? (
        <button type="button" onClick={onClear} className={footerButton}>
          Clear
        </button>
      ) : (
        <span />
      )}
      <button type="button" onClick={onDone} className={buttonClass("primary", "sm")}>
        Done
      </button>
    </div>
  );
}
