"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { countdownText } from "../lib/rules";
import "./privacy.css";

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d);

/**
 * One 72-hour clock: a live countdown while it runs (gold under a day, red once overdue), or
 * when it was done and whether that was in time. Ticks every 30 seconds.
 */
export function Countdown({ label, due, done }: { label: string; due: string; done: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, []);
  const dueAt = new Date(due);
  if (done) {
    const doneAt = new Date(done);
    const late = doneAt > dueAt;
    return (
      <div className="rounded-2xl border border-line bg-surface px-3.5 py-3">
        <p className="text-[12px] text-muted">{label}</p>
        <p className={cx("mt-0.5 text-[14px] font-medium", late ? "text-danger" : "text-brand-strong")}>
          Done {when(doneAt)} {late ? "(late)" : "(in time)"}
        </p>
      </div>
    );
  }
  const left = now === null ? null : dueAt.getTime() - now;
  const tone = left === null ? "" : left < 0 ? "danger" : left < 24 * 3_600_000 ? "gold" : "";
  return (
    <div className={cx("rounded-2xl border px-3.5 py-3", tone === "danger" ? "border-danger/40 bg-danger-soft" : tone === "gold" ? "border-gold/60 bg-gold-soft/60" : "border-line bg-surface")}>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        {tone && <span aria-hidden className={cx("dp-pulse size-1.5 rounded-full", tone === "danger" ? "bg-danger" : "bg-gold")} />}
        {label}
      </p>
      <p className={cx("tabular mt-0.5 text-[14px] font-medium", tone === "danger" ? "text-danger" : tone === "gold" ? "text-gold-strong" : "")} aria-live="polite">
        {left === null ? `Due ${when(dueAt)}` : countdownText(left)}
      </p>
      <p className="text-[12px] text-muted">Due {when(dueAt)}</p>
    </div>
  );
}
