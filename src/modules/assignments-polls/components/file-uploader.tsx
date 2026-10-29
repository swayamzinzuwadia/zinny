"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, cx } from "@/components/ui";

export type ExistingFile = { id: string; fileName: string; sizeBytes: number; href?: string };

type Item = { key: string; name: string; size: number; progress: number; fileId?: string; error?: string; done: boolean };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function call(endpoint: string, body: unknown) {
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: "Your session may have ended. Reload the page and sign in again." }));
  if (!res.ok) throw new Error(data.error ?? "The upload failed. Try again.");
  return data;
}

/**
 * Uploads files as soon as they're picked (in parts, so large files work), then adds their
 * ids to the form as hidden fields. The form can't be sent while an upload is running.
 * Existing files are listed with a remove option (`keepName` keeps them, `removeName` drops them).
 */
export function FileUploader({
  endpoint,
  target,
  name = "fileIds",
  max,
  maxMb,
  accept,
  hint,
  label,
  existing = [],
  keepName,
  removeName,
}: {
  endpoint: string;
  target: Record<string, string>;
  name?: string;
  max: number;
  maxMb: number;
  accept: string;
  hint?: string;
  label: string;
  existing?: ExistingFile[];
  /** Kept existing files are sent under this name (e.g. keepFileIds). */
  keepName?: string;
  /** Removed existing files are sent under this name (e.g. removeFileIds). */
  removeName?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [kept, setKept] = useState<ExistingFile[]>(existing);
  const [removed, setRemoved] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const busy = items.some((i) => !i.done && !i.error);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const onSubmit = (e: Event) => {
      if (busyRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setNotice("Wait for your files to finish uploading, then try again.");
      }
    };
    const onReset = () => {
      setItems([]);
      setRemoved([]);
      setNotice(null);
    };
    form.addEventListener("submit", onSubmit, true);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("submit", onSubmit, true);
      form.removeEventListener("reset", onReset);
    };
  }, []);

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function send(file: File, key: string) {
    try {
      const started = await call(endpoint, { op: "start", ...target, fileName: file.name, size: file.size });
      for (let i = 0; i < started.parts; i++) {
        const part = file.slice(i * started.partBytes, (i + 1) * started.partBytes);
        const q = new URLSearchParams({ op: "part", fileId: started.fileId, index: String(i) });
        const res = await fetch(`${endpoint}?${q}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: part });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "The upload stopped part way. Try again.");
        }
        update(key, { progress: Math.round(((i + 1) / started.parts) * 95) });
      }
      await call(endpoint, { op: "finish", fileId: started.fileId });
      update(key, { progress: 100, done: true, fileId: started.fileId });
    } catch (e) {
      update(key, { error: e instanceof Error ? e.message : "The upload failed. Try again." });
    }
  }

  function pick(files: FileList | null) {
    setNotice(null);
    if (!files?.length) return;
    const live = items.filter((i) => !i.error).length + kept.length;
    const room = max - live;
    const chosen = Array.from(files);
    if (room <= 0) {
      setNotice(`You can add at most ${max} file${max === 1 ? "" : "s"}. Remove one first.`);
      return;
    }
    if (chosen.length > room) setNotice(`Only the first ${room} file${room === 1 ? "" : "s"} were added: the limit is ${max}.`);
    for (const file of chosen.slice(0, room)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      if (file.size > maxMb * 1024 * 1024) {
        setItems((l) => [...l, { key, name: file.name, size: file.size, progress: 0, done: false, error: `Larger than ${maxMb} MB. Make it smaller or split it into parts.` }]);
        continue;
      }
      if (file.size === 0) {
        setItems((l) => [...l, { key, name: file.name, size: 0, progress: 0, done: false, error: "This file is empty." }]);
        continue;
      }
      setItems((l) => [...l, { key, name: file.name, size: file.size, progress: 2, done: false }]);
      void send(file, key);
    }
    if (picker.current) picker.current.value = "";
  }

  const count = items.filter((i) => !i.error).length + kept.length;

  return (
    <div ref={root}>
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <ul className="space-y-2">
        {kept.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-[14px]">
            <span className="min-w-0 truncate">
              {f.href ? (
                <a className="text-brand hover:underline" href={f.href} target="_blank" rel="noreferrer">
                  {f.fileName}
                </a>
              ) : (
                f.fileName
              )}{" "}
              <span className="text-faint">{formatBytes(f.sizeBytes)}</span>
            </span>
            {keepName && <input type="hidden" name={keepName} value={f.id} />}
            <button
              type="button"
              className="shrink-0 text-[13px] text-danger hover:underline"
              onClick={() => {
                setKept((l) => l.filter((x) => x.id !== f.id));
                setRemoved((r) => [...r, f.id]);
              }}
            >
              Remove
            </button>
          </li>
        ))}
        {removeName && removed.map((id) => <input key={id} type="hidden" name={removeName} value={id} />)}
        {items.map((i) => (
          <li key={i.key} className={cx("rounded-xl border px-3 py-2 text-[14px]", i.error ? "border-danger/40 bg-danger-soft" : "border-line bg-surface")}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {i.name} <span className="text-faint">{formatBytes(i.size)}</span>
              </span>
              <button type="button" className="shrink-0 text-[13px] text-danger hover:underline" onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>
                Remove
              </button>
            </div>
            {i.error ? (
              <p className="mt-1 text-[13px] text-danger">{i.error}</p>
            ) : !i.done ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${i.name}`}>
                <div className="h-full bg-brand transition-all" style={{ width: `${i.progress}%` }} />
              </div>
            ) : (
              <p className="mt-0.5 text-[12px] text-brand-strong">Uploaded</p>
            )}
            {i.done && i.fileId && <input type="hidden" name={name} value={i.fileId} />}
          </li>
        ))}
      </ul>
      {count < max && (
        <label className={cx(buttonClass("secondary", "sm"), "mt-2 cursor-pointer")}>
          <input ref={picker} type="file" multiple={max - count > 1} accept={accept} className="sr-only" onChange={(e) => pick(e.target.files)} />
          {count ? "Add another file" : "Choose files"}
        </label>
      )}
      <p className="mt-1.5 text-[12px] text-muted">
        {hint ?? `Up to ${max} file${max === 1 ? "" : "s"}, ${maxMb} MB each.`}
      </p>
      {notice && <p className="mt-2 rounded-xl bg-gold-soft px-3 py-2 text-[13px] text-warn">{notice}</p>}
    </div>
  );
}
