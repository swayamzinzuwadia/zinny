"use client";

/**
 * Uploads a video or PDF for a lesson in parts of at most 4 MB (with retries), then asks
 * the server to join them. Shows progress and lets the person cancel. Video length is
 * read in the browser so progress tracking knows the duration.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass, cx } from "@/components/ui";
import { ACCEPT, MAX_BYTES, formatBytes, type UploadKind } from "../lib/files";
import { ProgressBar } from "./bits";

type Phase = { step: "idle" } | { step: "sending"; sent: number; total: number; name: string } | { step: "joining"; name: string } | { step: "done"; name: string } | { step: "error"; message: string };

async function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

async function call(url: string, init: RequestInit, signal: AbortSignal) {
  const res = await fetch(url, { ...init, signal, credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(String(body.error ?? "The upload failed. Try again.")), { status: res.status });
  return body;
}

export function FileUpload({ uploadsUrl, lessonId, kind, hasFile }: { uploadsUrl: string; lessonId: string; kind: UploadKind; hasFile: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const busy = phase.step === "sending" || phase.step === "joining";

  async function upload(file: File) {
    if (file.size > MAX_BYTES[kind]) {
      setPhase({
        step: "error",
        message:
          kind === "video"
            ? `This video is ${formatBytes(file.size)}. Videos can be up to ${formatBytes(MAX_BYTES.video)}; compress it or paste a YouTube or Vimeo link instead.`
            : `This PDF is ${formatBytes(file.size)}. PDFs can be up to ${formatBytes(MAX_BYTES.pdf)}.`,
      });
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      setPhase({ step: "sending", sent: 0, total: file.size, name: file.name });
      const durationSeconds = kind === "video" ? await videoDuration(file) : null;
      const start = await call(
        uploadsUrl,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonId, fileName: file.name, size: file.size, durationSeconds }) },
        ctrl.signal,
      );
      const uploadId = String(start.uploadId);
      const partSize = Number(start.partSize);
      const count = Number(start.partCount);
      for (let n = 0; n < count; n++) {
        const blob = file.slice(n * partSize, Math.min(file.size, (n + 1) * partSize));
        for (let attempt = 1; ; attempt++) {
          try {
            await call(`${uploadsUrl}/${uploadId}?part=${n}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: blob }, ctrl.signal);
            break;
          } catch (e) {
            const status = (e as { status?: number }).status ?? 0;
            if (ctrl.signal.aborted || (status >= 400 && status < 500) || attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
        setPhase({ step: "sending", sent: Math.min(file.size, (n + 1) * partSize), total: file.size, name: file.name });
      }
      setPhase({ step: "joining", name: file.name });
      await call(`${uploadsUrl}/${uploadId}`, { method: "POST" }, ctrl.signal);
      setPhase({ step: "done", name: file.name });
      router.refresh();
    } catch (e) {
      if (ctrl.signal.aborted) setPhase({ step: "idle" });
      else setPhase({ step: "error", message: e instanceof Error ? e.message : "The upload failed. Try again." });
    } finally {
      abort.current = null;
      if (input.current) input.current.value = "";
    }
  }

  const label = kind === "pdf" ? (hasFile ? "Replace PDF" : "Upload PDF") : hasFile ? "Replace video" : "Upload video";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className={cx(buttonClass(hasFile ? "secondary" : "primary"), busy && "pointer-events-none opacity-50", "cursor-pointer")}>
          {label}
          <input
            ref={input}
            type="file"
            accept={ACCEPT[kind]}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </label>
        <span className="text-[13px] text-muted">
          {kind === "pdf" ? `PDF, up to ${formatBytes(MAX_BYTES.pdf)}` : `MP4, WebM or MOV, up to ${formatBytes(MAX_BYTES.video)}`}
        </span>
      </div>
      {phase.step === "sending" && (
        <div className="mt-4 max-w-md" aria-live="polite">
          <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
            <span className="truncate">Uploading {phase.name}</span>
            <span className="tabular shrink-0 text-muted">
              {formatBytes(phase.sent)} of {formatBytes(phase.total)}
            </span>
          </div>
          <ProgressBar percent={(phase.sent / phase.total) * 100} label="Upload progress" />
          <button type="button" onClick={() => abort.current?.abort()} className="mt-2 text-[13px] text-danger hover:underline">
            Cancel upload
          </button>
        </div>
      )}
      {phase.step === "joining" && <p className="mt-4 text-[13px] text-muted" aria-live="polite">Saving {phase.name}…</p>}
      {phase.step === "done" && <p className="mt-4 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong" aria-live="polite">{phase.name} is uploaded. Students see it now.</p>}
      {phase.step === "error" && <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{phase.message}</p>}
    </div>
  );
}
