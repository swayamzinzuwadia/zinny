"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import "@/components/combobox.css";
import { Highlight } from "@/components/combobox";
import { cx } from "@/components/ui";
import type { SearchGroup, SearchHit, SearchKind } from "../services/search";
import { highlightParts } from "./institute-rank";
import "./global-search.css";

const RECENT_KEY = "zinny.platform.recent";
const MAX_RECENT = 5;

type Row = { hit: SearchHit; group: string } | { submit: true };

/* ───────────────────────────── Recents (this browser only) ───────────────────────────── */

function readRecent(): SearchHit[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as SearchHit[]) : [];
    return Array.isArray(list) ? list.filter((h) => h && typeof h.href === "string" && h.href.startsWith("/platform")).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function rememberRecent(hit: SearchHit) {
  try {
    const next = [hit, ...readRecent().filter((h) => h.href !== hit.href)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: recents just don't persist.
  }
}

/* ───────────────────────────── Icons ───────────────────────────── */

const ICONS: Record<SearchKind, ReactNode> = {
  page: <path d="M5 3.5h7l3 3V16a.5.5 0 0 1-.5.5h-9.5A.5.5 0 0 1 4.5 16V4a.5.5 0 0 1 .5-.5ZM12 3.5V7h3M7 10.5h6M7 13h4" />,
  institute: <path d="M3 8.5 10 4l7 4.5M5 9v6.5M8.5 9v6.5M11.5 9v6.5M15 9v6.5M3.5 16.5h13" />,
  person: <path d="M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 16.5c.5-3 2.7-4.5 6-4.5s5.5 1.5 6 4.5" />,
  plan: <path d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7ZM3.5 6.5 10 10l6.5-3.5M10 10v7" />,
  invoice: <path d="M5.5 3.5h9v13l-2-1.3-2.5 1.3-2.5-1.3-2 1.3v-13ZM8 7.5h4M8 10.5h4" />,
  course: <path d="M3 5.5 10 3l7 2.5-7 2.5-7-2.5ZM6 8v4c0 1 1.8 2 4 2s4-1 4-2V8" />,
};

function KindIcon({ kind, className }: { kind: SearchKind; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cx("size-[18px]", className)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[kind]}
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.3 1.5" />
    </svg>
  );
}

/* ───────────────────────────── The search itself ───────────────────────────── */

async function fetchGroups(q: string, signal: AbortSignal): Promise<SearchGroup[]> {
  const res = await fetch(`/platform/search?q=${encodeURIComponent(q)}`, { signal, credentials: "same-origin" });
  if (!res.ok) throw new Error("Search failed");
  return ((await res.json()) as { groups: SearchGroup[] }).groups;
}

function useGlobalSearch(canSearchInstitutes: boolean, active: boolean, onDone: () => void) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [suggested, setSuggested] = useState<SearchGroup[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [settled, setSettled] = useState("");
  const [activeIx, setActiveIx] = useState(-1);
  const cache = useRef(new Map<string, SearchGroup[]>());
  const term = q.trim();

  // What to suggest before anything is typed: fetched once, plus recents from this browser.
  useEffect(() => {
    if (!active) return;
    setRecent(readRecent());
    if (suggested.length) return;
    const ctl = new AbortController();
    fetchGroups("", ctl.signal)
      .then(setSuggested)
      .catch(() => {});
    return () => ctl.abort();
  }, [active, suggested.length]);

  // Ask after a short pause; typing again cancels the request still in flight.
  useEffect(() => {
    if (!term) {
      setGroups([]);
      setLoading(false);
      setFailed(false);
      setSettled("");
      return;
    }
    const cached = cache.current.get(term.toLowerCase());
    if (cached) {
      setGroups(cached);
      setSettled(term);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = await fetchGroups(term, ctl.signal);
        cache.current.set(term.toLowerCase(), found);
        setGroups(found);
        setSettled(term);
        setFailed(false);
        setActiveIx(-1);
      } catch {
        if (!ctl.signal.aborted) setFailed(true);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [term]);

  const shown: { label: string; hits: SearchHit[]; kind?: SearchKind; recent?: boolean }[] = useMemo(() => {
    if (term) return groups.map((g) => ({ label: g.label, hits: g.hits, kind: g.kind }));
    const out: { label: string; hits: SearchHit[]; kind?: SearchKind; recent?: boolean }[] = [];
    if (recent.length) out.push({ label: "Recently opened", hits: recent, recent: true });
    const seen = new Set(recent.map((r) => r.href));
    for (const g of suggested) {
      const hits = g.hits.filter((h) => !seen.has(h.href)).slice(0, recent.length ? 3 : 5);
      if (hits.length) out.push({ label: g.label, hits, kind: g.kind });
    }
    return out;
  }, [term, groups, recent, suggested]);

  const rows: Row[] = useMemo(() => {
    const flat: Row[] = shown.flatMap((g) => g.hits.map((hit) => ({ hit, group: g.label })));
    if (term && canSearchInstitutes) flat.push({ submit: true });
    return flat;
  }, [shown, term, canSearchInstitutes]);

  const go = useCallback(
    (href: string) => {
      onDone();
      startTransition(() => router.push(href));
    },
    [router, onDone],
  );

  const choose = useCallback(
    (row: Row) => {
      if ("submit" in row) go(`/platform/institutes?q=${encodeURIComponent(term)}`);
      else {
        rememberRecent(row.hit);
        go(row.hit.href);
      }
    },
    [go, term],
  );

  const none = !!term && !loading && !failed && settled === term && groups.length === 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = rows.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!n) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIx((a) => (a === -1 ? (step === 1 ? 0 : n - 1) : (a + step + n) % n));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIx >= 0 ? activeIx : 0];
      if (row && (activeIx >= 0 || !term || settled === term)) choose(row);
      else if (term && canSearchInstitutes) choose({ submit: true });
    } else if (e.key === "Home" && n) {
      e.preventDefault();
      setActiveIx(0);
    } else if (e.key === "End" && n) {
      e.preventDefault();
      setActiveIx(n - 1);
    }
  }

  return { q, setQ, term, shown, rows, loading, failed, none, activeIx, setActiveIx, choose, onKeyDown, reset: () => (setQ(""), setActiveIx(-1)) };
}

type Search = ReturnType<typeof useGlobalSearch>;

/* ───────────────────────────── The list of results ───────────────────────────── */

function Results({ s, uid }: { s: Search; uid: string }) {
  let ix = -1;
  const { shown, term } = s;
  return (
    <ul id={`${uid}-list`} role="listbox" aria-label="Search results" className="max-h-[min(520px,64dvh)] overflow-y-auto overscroll-contain p-1.5" onMouseDown={(e) => e.preventDefault()}>
      {shown.map((g) => (
        <li key={g.label} role="presentation" className="[&+&]:mt-1">
          <div className="px-3 pt-2 pb-1 text-[12px] font-medium text-muted">{g.label}</div>
          <ul role="group" aria-label={g.label}>
            {g.hits.map((hit) => {
              ix += 1;
              const i = ix;
              const on = s.activeIx === i;
              return (
                <li
                  key={`${g.label}-${hit.href}-${hit.id}`}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => s.setActiveIx(i)}
                  onClick={() => s.choose(s.rows[i])}
                  className={cx("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 [transition-property:background-color] duration-100", on && "bg-brand-soft")}
                >
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg border [transition-property:background-color,color,border-color] duration-100", on ? "border-brand/25 bg-surface text-brand-strong" : "border-line bg-canvas text-muted")}>
                    {g.recent ? <ClockIcon /> : <KindIcon kind={hit.kind} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">
                      <Highlight parts={highlightParts(hit.title, term)} />
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">
                      <Highlight parts={highlightParts(hit.detail, term)} />
                    </span>
                  </span>
                  {hit.tag && <span className={cx("hidden max-w-[40%] shrink-0 truncate text-right text-[12px] sm:block", hit.tone === "danger" ? "text-danger" : "text-muted")}>{hit.tag}</span>}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
      {term && s.rows.some((r) => "submit" in r) && (
        <li
          id={`${uid}-opt-${s.rows.length - 1}`}
          role="option"
          aria-selected={s.activeIx === s.rows.length - 1}
          onMouseEnter={() => s.setActiveIx(s.rows.length - 1)}
          onClick={() => s.choose({ submit: true })}
          className={cx("mt-1 flex cursor-pointer items-center gap-3 rounded-xl border-t border-line px-3 py-2.5 text-[13px] text-muted [transition-property:background-color] duration-100", s.activeIx === s.rows.length - 1 && "bg-brand-soft text-ink")}
        >
          <KindIcon kind="institute" className="mx-[7px] text-faint" />
          <span className="min-w-0 truncate">Search institutes for “{term}”</span>
        </li>
      )}
      {s.none && <li className="px-3 py-3 text-[14px] text-muted">Nothing matches “{term}”. Try a shorter word, or the name of a page.</li>}
      {s.failed && <li className="px-3 py-3 text-[14px] text-danger">Search didn’t load. Check your connection and type again.</li>}
    </ul>
  );
}

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="grid size-6 place-items-center rounded-full text-faint [transition-property:background-color,color] duration-150 hover:bg-canvas hover:text-ink">
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="m4 4 8 8M12 4 4 12" />
      </svg>
    </button>
  );
}

/* ───────────────────────────── The two shells ───────────────────────────── */

/**
 * One search for the whole Zinny team panel: pages, institutes, people, plans, invoices and
 * courses, grouped and limited to what this person may open. A search box in the top bar
 * from tablet width up (press / or Ctrl K anywhere); below that, an icon button opens the
 * same search as a sheet.
 */
export function GlobalSearch({ canSearchInstitutes, className }: { canSearchInstitutes: boolean; className?: string }) {
  const uid = useId();
  const [wide, setWide] = useState(true);
  const [focused, setFocused] = useState(false);
  const [sheet, setSheet] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const closeAll = useCallback(() => {
    setFocused(false);
    setSheet(false);
    input.current?.blur();
  }, []);
  const s = useGlobalSearch(canSearchInstitutes, focused || sheet, closeAll);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // "/" (when not typing) and Ctrl/Cmd K open the search from anywhere in the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const slash = !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "/";
      if (!combo && !slash) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 768px)").matches) {
        input.current?.focus();
        input.current?.select();
      } else setSheet(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The sheet locks the page behind it and closes on Escape.
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSheet(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (s.activeIx >= 0) document.getElementById(`${uid}-opt-${s.activeIx}`)?.scrollIntoView({ block: "nearest" });
  }, [s.activeIx, uid]);

  const hasList = s.shown.length > 0 || s.none || s.failed;
  const showPop = wide && focused && hasList;
  const activeId = s.activeIx >= 0 ? `${uid}-opt-${s.activeIx}` : undefined;

  const field = (ref: React.RefObject<HTMLInputElement | null>, isSheet: boolean) => (
    <>
      <SearchGlyph className="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-label="Search Zinny"
        aria-expanded={isSheet ? hasList : showPop}
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search Zinny"
        value={s.q}
        onChange={(e) => {
          s.setQ(e.target.value);
          s.setActiveIx(-1);
        }}
        onFocus={() => !isSheet && setFocused(true)}
        onBlur={() => !isSheet && setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !isSheet) {
            e.preventDefault();
            if (focused && hasList) setFocused(false);
            else if (s.q) s.reset();
            else input.current?.blur();
            return;
          }
          s.onKeyDown(e);
        }}
        className={cx(
          "w-full rounded-full border border-line bg-surface pr-16 pl-10 text-[14px] text-ink outline-none [transition-property:border-color,box-shadow] duration-150 placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-gold-soft",
          isSheet ? "h-11" : "h-9",
        )}
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
        {s.loading && <span aria-hidden className="cbx-spin size-3.5 rounded-full border-2 border-line border-t-brand" />}
        {s.q ? (
          <ClearButton
            onClick={() => {
              s.reset();
              (isSheet ? sheetInput : input).current?.focus();
            }}
          />
        ) : (
          !isSheet && (
            <kbd aria-hidden className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-faint">
              /
            </kbd>
          )
        )}
      </div>
    </>
  );

  return (
    <>
      {/* From tablet width: the box sits in the top bar and its list opens out of it. */}
      <div className={cx("relative hidden w-full max-w-[340px] md:block", className)}>
        {field(input, false)}
        {showPop && (
          <div className="cbx-pop absolute top-[calc(100%+6px)] right-0 z-40 w-[min(480px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_12px_32px_-8px_rgb(0_0_0/0.18)]">
            <Results s={s} uid={uid} />
            <Footer />
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {s.term && !s.loading ? `${s.rows.filter((r) => !("submit" in r)).length} results` : ""}
        </span>
      </div>

      {/* Below tablet width: an icon button opens the same search as a sheet. */}
      <button
        ref={trigger}
        type="button"
        aria-label="Search Zinny"
        aria-haspopup="dialog"
        onClick={() => setSheet(true)}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted [transition-property:border-color,color] duration-150 hover:border-faint hover:text-ink md:hidden"
      >
        <SearchGlyph className="size-[18px]" />
      </button>
      {sheet && !wide && (
        <div className="gs-scrim fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div role="dialog" aria-modal="true" aria-label="Search Zinny" className="gs-sheet mx-3 mt-3 origin-top-right overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_18px_48px_-12px_rgb(0_0_0/0.35)]">
            <div className="flex items-center gap-2 p-3">
              <div className="relative min-w-0 flex-1">{field(sheetInput, true)}</div>
              <button type="button" onClick={() => setSheet(false)} className="shrink-0 rounded-full px-3 py-2 text-[14px] text-muted hover:text-ink">
                Close
              </button>
            </div>
            <SheetAutofocus input={sheetInput} />
            {hasList && (
              <div className="border-t border-line">
                <Results s={s} uid={uid} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SheetAutofocus({ input }: { input: React.RefObject<HTMLInputElement | null> }) {
  useEffect(() => {
    input.current?.focus();
  }, [input]);
  return null;
}

function Footer() {
  return (
    <div className="flex items-center gap-4 border-t border-line bg-canvas px-4 py-2 text-[12px] text-muted">
      <span>
        <kbd className="rounded border border-line bg-surface px-1">↑</kbd> <kbd className="rounded border border-line bg-surface px-1">↓</kbd> to move
      </span>
      <span>
        <kbd className="rounded border border-line bg-surface px-1">Enter</kbd> to open
      </span>
      <span>
        <kbd className="rounded border border-line bg-surface px-1">Esc</kbd> to close
      </span>
    </div>
  );
}
