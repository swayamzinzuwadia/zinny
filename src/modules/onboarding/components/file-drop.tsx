"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Badge, buttonClass, cx } from "@/components/ui";
import { DOCUMENT_ACCEPT, documentProblem, documentType, DOCUMENT_TYPES, formatBytes } from "../lib/constants";
import "./motion.css";

/**
 * One document slot: drop a file on it or choose one. Checks type (PDF, JPG, PNG) and size
 * (up to 10 MB) before anything is sent, then shows the file's name, type and size with
 * Replace and Remove. `status` shows what happened to it once sent.
 */
export function FileDrop({
  label,
  hint,
  required,
  file,
  onChange,
  error,
  progress,
  extra,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null, problem: string | null) => void;
  error?: string | null;
  /** 0 to 1 while the file is being sent. */
  progress?: number | null;
  /** Shown under the file, e.g. a review status. */
  extra?: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (f: File | undefined | null) => {
    if (!f) return;
    onChange(f, documentProblem(f));
  };
  const choose = () => input.current?.click();
  const type = file ? documentType(file.name, file.type) : null;
  const busy = progress !== null && progress !== undefined;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium">
          {label}
        </label>
        {required ? <Badge tone="gold">Required</Badge> : <span className="text-[12px] text-muted">Optional</span>}
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className={cx("onb-pop rounded-2xl border bg-surface p-3", error ? "border-danger/50" : "border-line")}>
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-[11px] font-semibold text-brand-strong">
              {type ? DOCUMENT_TYPES[type].label : "?"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium" title={file.name}>
                {file.name}
              </div>
              <div className="text-[12px] text-muted">{formatBytes(file.size)}</div>
            </div>
            {!busy && (
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={choose} className={buttonClass("quiet", "sm")}>
                  <ActionIcon name="upload" />
                  Replace
                </button>
                <button type="button" onClick={() => onChange(null, null)} className={buttonClass("quietDanger", "sm")}>
                  <ActionIcon name="delete" />
                  Remove
                </button>
              </div>
            )}
          </div>
          {busy && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-label={`Sending ${file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress! * 100)}>
              <div className="onb-bar h-full rounded-full bg-brand" style={{ width: `${Math.max(4, progress! * 100)}%` }} />
            </div>
          )}
          {extra}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onClick={choose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              choose();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed px-4 py-5 text-center transition-[background-color,border-color,transform] duration-150 outline-none focus-visible:ring-4 focus-visible:ring-gold-soft",
            over ? "scale-[1.01] border-brand bg-brand-soft" : error ? "border-danger/50 bg-surface" : "border-line bg-surface hover:border-brand/50",
          )}
        >
          <span className="flex items-center gap-2 text-[14px] font-medium text-brand">
            <ActionIcon name="upload" />
            {over ? "Drop it here" : "Choose a file or drop it here"}
          </span>
          <span className="text-[12px] text-muted">PDF, JPG or PNG, up to 10 MB</span>
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p role="alert" className="onb-pop mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
