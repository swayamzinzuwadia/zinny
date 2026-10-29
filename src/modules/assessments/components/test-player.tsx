"use client";

/**
 * Taking a test, in the browser. Everything that matters is decided on the server:
 *   - the timer counts down to the attempt's end time from the server, corrected for the
 *     device's clock, and the server refuses answers after it;
 *   - every change is saved straight away (text after a short pause), and a reload resumes;
 *   - leaving the tab or full screen is sent to the server, which counts it and may submit.
 * The paper this component gets never contains answers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, cx } from "@/components/ui";
import type { PaperItem, PaperView } from "../attempts";
import { proctorEventAction, saveAnswerAction, submitAttemptAction } from "../learner-actions";
import type { QuestionResponse } from "../schema";

type SaveState = "saved" | "saving" | "error";

function isAnswered(r: QuestionResponse | null): boolean {
  if (!r) return false;
  if ("options" in r) return r.options.length > 0;
  if ("text" in r) return r.text.trim().length > 0;
  return true;
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function TestPlayer({ uni, paper }: { uni: string; paper: PaperView }) {
  const router = useRouter();
  const resultHref = `/${uni}/learn/tests/attempt/${paper.attemptId}/result`;
  const [responses, setResponses] = useState<Record<string, QuestionResponse | null>>(() => Object.fromEntries(paper.items.map((i) => [i.id, i.response])));
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [tabSwitches, setTabSwitches] = useState(paper.tabSwitches);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isFull, setIsFull] = useState(true);
  const done = useRef(false);

  // Server clock minus device clock, so a wrong device time can't stretch the timer.
  const skew = useMemo(() => new Date(paper.serverNow).getTime() - Date.now(), [paper.serverNow]);
  const endsAt = paper.endsAt ? new Date(paper.endsAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now() + skew);

  const finish = useCallback(
    (message?: string) => {
      if (done.current) return;
      done.current = true;
      if (message) setNotice(message);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      router.replace(resultHref);
    },
    [resultHref, router],
  );

  /* Saving: one in-flight save per question, the latest value always wins. */
  const pending = useRef<Record<string, { value: QuestionResponse | null; timer?: ReturnType<typeof setTimeout>; running?: boolean; again?: boolean }>>({});
  const flush = useCallback(
    async (itemId: string) => {
      const p = pending.current[itemId];
      if (!p || done.current) return;
      if (p.running) {
        p.again = true;
        return;
      }
      p.running = true;
      setSaveState((s) => ({ ...s, [itemId]: "saving" }));
      let res: Awaited<ReturnType<typeof saveAnswerAction>> | null = null;
      try {
        res = await saveAnswerAction(uni, paper.attemptId, itemId, p.value);
      } catch {
        res = null;
      }
      p.running = false;
      if (res && "ok" in res && res.ok) {
        setSaveState((s) => ({ ...s, [itemId]: p.again ? "saving" : "saved" }));
      } else if (res && "submitted" in res) {
        finish(res.message);
        return;
      } else {
        setSaveState((s) => ({ ...s, [itemId]: "error" }));
        if (res && "error" in res) setNotice(res.error);
        // Try again shortly; the latest value is still in `pending`.
        p.timer = setTimeout(() => flush(itemId), 3000);
        return;
      }
      if (p.again) {
        p.again = false;
        flush(itemId);
      }
    },
    [finish, paper.attemptId, uni],
  );

  const answer = useCallback(
    (item: PaperItem, value: QuestionResponse | null, opts: { debounce?: boolean } = {}) => {
      if (done.current) return;
      setResponses((r) => ({ ...r, [item.id]: value }));
      const p = (pending.current[item.id] ??= { value });
      p.value = value;
      if (p.timer) clearTimeout(p.timer);
      setSaveState((s) => ({ ...s, [item.id]: "saving" }));
      if (opts.debounce) p.timer = setTimeout(() => flush(item.id), 600);
      else flush(item.id);
    },
    [flush],
  );

  const flushAll = useCallback(async () => {
    const ids = Object.keys(pending.current);
    for (const id of ids) {
      const p = pending.current[id];
      if (p.timer) clearTimeout(p.timer);
    }
    await Promise.all(ids.map((id) => flush(id)));
  }, [flush]);

  /* The timer. At zero, save what's pending and submit; the server would submit anyway. */
  useEffect(() => {
    if (!endsAt) return;
    const tick = setInterval(() => setNow(Date.now() + skew), 500);
    return () => clearInterval(tick);
  }, [endsAt, skew]);

  const submit = useCallback(async () => {
    if (done.current) return;
    setSubmitting(true);
    await flushAll();
    const res = await submitAttemptAction(uni, paper.attemptId).catch(() => null);
    if (res && "attemptId" in res) finish();
    else {
      setSubmitting(false);
      setNotice(res && "error" in res ? res.error : "Couldn't submit. Check your connection and try again.");
    }
  }, [finish, flushAll, paper.attemptId, uni]);

  const remaining = endsAt ? endsAt - now : null;
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !done.current) {
      setNotice("Time is up. Submitting your test…");
      submit();
    }
  }, [remaining, submit]);

  /* Proctoring: leaving the page and leaving full screen are recorded on the server. */
  const report = useCallback(
    async (kind: "tab_hidden" | "fullscreen_exit") => {
      if (done.current) return;
      const res = await proctorEventAction(uni, paper.attemptId, kind).catch(() => null);
      if (!res || "error" in res) return;
      setTabSwitches(res.tabSwitches);
      if (res.submitted) finish("You left the test too many times, so it was submitted.");
      else if (kind === "tab_hidden" && res.limit !== null) {
        const left = res.limit - res.tabSwitches;
        setNotice(
          left > 0
            ? `You left the test. ${left} more time${left === 1 ? "" : "s"} and it will be submitted.`
            : "You left the test. Once more and it will be submitted.",
        );
      } else if (kind === "fullscreen_exit") setNotice("You left full screen. This has been recorded.");
    },
    [finish, paper.attemptId, uni],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report("tab_hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [report]);

  useEffect(() => {
    if (!paper.fullscreenRequired) return;
    const supported = typeof document !== "undefined" && document.fullscreenEnabled;
    const sync = () => setIsFull(!supported || !!document.fullscreenElement);
    sync();
    const onChange = () => {
      const full = !!document.fullscreenElement;
      setIsFull(full || !supported);
      if (!full && supported && !done.current) report("fullscreen_exit");
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [paper.fullscreenRequired, report]);

  // Warn before closing the tab with an unsaved change.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.values(saveState).some((s) => s !== "saved") && !done.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [saveState]);

  const items = paper.items;
  const shown = paper.onePerPage ? [items[page]] : items;
  const answered = items.filter((i) => isAnswered(responses[i.id])).length;
  const unsaved = Object.values(saveState).filter((s) => s !== "saved").length;
  const low = remaining !== null && remaining < 5 * 60_000;
  const anyError = Object.values(saveState).includes("error");

  return (
    // The test takes the whole screen, above the app's header and tab bar: nothing to tap away to.
    <div data-learner-focus className="fixed inset-0 z-40 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-3xl px-4 pb-28 sm:px-6">
        {/* Sticky bar: title, timer, progress, save state */}
        <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{paper.title}</div>
              <div className="text-[12px] text-muted">
                {answered} of {items.length} answered ·{" "}
                <span className={cx(anyError && "text-danger")} aria-live="polite">
                  {anyError ? "Not saved, retrying" : unsaved ? "Saving…" : "All answers saved"}
                </span>
              </div>
            </div>
            {remaining !== null && (
              <div
                className={cx(
                  "tabular shrink-0 rounded-full px-3.5 py-1.5 text-[16px] font-semibold",
                  low ? "bg-gold text-brand-deep" : "bg-brand-deep text-canvas",
                )}
                role="timer"
                aria-label={`Time left ${clock(remaining)}`}
              >
                {clock(remaining)}
              </div>
            )}
          </div>
          <div className="mt-2 flex h-1 gap-0.5" aria-hidden>
            {items.map((i, k) => (
              <button
                key={i.id}
                type="button"
                tabIndex={-1}
                onClick={() => paper.onePerPage && setPage(k)}
                className={cx(
                  "flex-1 rounded-full",
                  isAnswered(responses[i.id]) ? "bg-brand" : "bg-line",
                  paper.onePerPage && k === page && "ring-2 ring-gold",
                )}
              />
            ))}
          </div>
        </div>

        {notice && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl bg-gold-soft px-4 py-3 text-[14px] text-ink" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-[13px] text-gold-strong">
              Dismiss
            </button>
          </div>
        )}

        {paper.fullscreenRequired && !isFull && !done.current && (
          <div className="mb-4 rounded-2xl border border-gold bg-surface p-4 text-[14px]">
            <p className="mb-3">This test runs in full screen. Leaving full screen is recorded.</p>
            <button
              type="button"
              className={buttonClass("gold", "sm")}
              onClick={() => document.documentElement.requestFullscreen().catch(() => setIsFull(true))}
            >
              Go back to full screen
            </button>
          </div>
        )}

        {paper.tabSwitchLimit !== null && tabSwitches > 0 && (
          <p className="mb-4 text-[13px] text-muted">
            You&apos;ve left the test {tabSwitches} time{tabSwitches === 1 ? "" : "s"}. Limit: {paper.tabSwitchLimit}.
          </p>
        )}

        <ol className="space-y-4">
          {shown.map((item) => (
            <QuestionCard
              key={item.id}
              item={item}
              index={item.position}
              total={items.length}
              value={responses[item.id] ?? null}
              state={saveState[item.id] ?? "saved"}
              onChange={(v, debounce) => answer(item, v, { debounce })}
            />
          ))}
        </ol>

        {/* Bottom bar: navigation and submit, within thumb reach on phones */}
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
            {paper.onePerPage ? (
              <div className="flex gap-2">
                <button type="button" className={buttonClass("secondary")} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                {page < items.length - 1 && (
                  <button type="button" className={buttonClass("secondary")} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                )}
              </div>
            ) : (
              <span className="text-[13px] text-muted">
                {answered} of {items.length} answered
              </span>
            )}
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="hidden text-[13px] text-muted sm:inline">
                  {items.length - answered ? `${items.length - answered} unanswered. ` : ""}Submit now?
                </span>
                <button type="button" className={buttonClass("secondary")} onClick={() => setConfirming(false)} disabled={submitting}>
                  Keep going
                </button>
                <button type="button" className={buttonClass("primary")} onClick={submit} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit test"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={buttonClass(paper.onePerPage && page < items.length - 1 ? "secondary" : "primary")}
                onClick={() => setConfirming(true)}
              >
                Submit test
              </button>
            )}
          </div>
          {confirming && items.length - answered > 0 && (
            <p className="mx-auto mt-1 max-w-3xl text-[12px] text-muted sm:hidden">
              {items.length - answered} unanswered. You can&apos;t change answers after submitting.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  item,
  index,
  total,
  value,
  state,
  onChange,
}: {
  item: PaperItem;
  index: number;
  total: number;
  value: QuestionResponse | null;
  state: SaveState;
  onChange: (v: QuestionResponse | null, debounce?: boolean) => void;
}) {
  const name = `q-${item.id}`;
  const picked = value && "option" in value ? value.option : null;
  const many = value && "options" in value ? value.options : [];
  return (
    <li className="rounded-[22px] border border-line bg-surface p-4 sm:p-6">
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
        <span>
          Question {index + 1} of {total}
        </span>
        <span>
          {item.marks} mark{item.marks === 1 ? "" : "s"}
          {item.negativeMarks > 0 && `, −${item.negativeMarks} if wrong`}
        </span>
      </div>
      <p id={`${name}-label`} className="mb-4 whitespace-pre-wrap text-[16px] font-medium leading-relaxed">
        {item.prompt}
      </p>

      {(item.type === "single" || item.type === "true_false") && (
        <div role="radiogroup" aria-labelledby={`${name}-label`} className={cx("grid gap-2", item.type === "true_false" && "grid-cols-2")}>
          {item.options.map((o, k) => (
            <label
              key={o.id}
              className={cx(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-[15px] transition-colors",
                picked === o.id ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={picked === o.id}
                onChange={() => onChange({ option: o.id })}
                className="h-4 w-4 accent-brand"
              />
              {item.type === "single" && <span className="text-[13px] text-muted">{String.fromCharCode(65 + k)}</span>}
              <span className="flex-1">{o.text}</span>
            </label>
          ))}
          {picked && (
            <button type="button" onClick={() => onChange(null)} className="justify-self-start text-[13px] text-muted underline-offset-4 hover:underline">
              Clear my answer
            </button>
          )}
        </div>
      )}

      {item.type === "multiple" && (
        <div role="group" aria-labelledby={`${name}-label`} className="grid gap-2">
          <p className="text-[13px] text-muted">Pick every right answer.</p>
          {item.options.map((o, k) => {
            const on = many.includes(o.id);
            return (
              <label
                key={o.id}
                className={cx(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-[15px]",
                  on ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const next = on ? many.filter((x) => x !== o.id) : [...many, o.id];
                    onChange(next.length ? { options: item.options.map((x) => x.id).filter((id) => next.includes(id)) } : null);
                  }}
                  className="h-4 w-4 accent-brand"
                />
                <span className="text-[13px] text-muted">{String.fromCharCode(65 + k)}</span>
                <span className="flex-1">{o.text}</span>
              </label>
            );
          })}
        </div>
      )}

      {item.type === "numeric" && <NumericInput labelledBy={`${name}-label`} value={value && "value" in value ? value.value : null} onChange={onChange} />}

      {item.type === "short" && (
        <textarea
          aria-labelledby={`${name}-label`}
          defaultValue={value && "text" in value ? value.text : ""}
          onChange={(e) => onChange(e.target.value.trim() ? { text: e.target.value } : null, true)}
          rows={5}
          maxLength={5000}
          placeholder="Type your answer"
          className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft"
        />
      )}

      <div className="mt-2 h-4 text-right text-[12px]" aria-live="polite">
        {state === "saving" && <span className="text-muted">Saving…</span>}
        {state === "error" && <span className="text-danger">Not saved yet. Retrying.</span>}
      </div>
    </li>
  );
}

function NumericInput({
  value,
  onChange,
  labelledBy,
}: {
  value: number | null;
  onChange: (v: QuestionResponse | null, debounce?: boolean) => void;
  labelledBy: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [bad, setBad] = useState(false);
  return (
    <div>
      <input
        inputMode="decimal"
        aria-labelledby={labelledBy}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const clean = t.trim().replace(/,/g, "");
          if (clean === "") {
            setBad(false);
            onChange(null, true);
          } else if (/^-?\d*\.?\d+$|^-?\d+\.?$/.test(clean)) {
            setBad(false);
            onChange({ value: Number(clean) }, true);
          } else setBad(true);
        }}
        placeholder="Your answer"
        className="h-12 w-full max-w-xs rounded-2xl border border-line bg-surface px-4 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-gold-soft"
      />
      {bad && <p className="mt-1 text-[13px] text-danger">Type a number, like 42 or 3.5.</p>}
    </div>
  );
}
