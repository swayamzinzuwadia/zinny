"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { buttonClass, cx } from "@/components/ui";
import { uploadImage } from "./upload";

/** Pick several photos; each is uploaded, then all are added to the end of the gallery. */
export function GalleryUploader({ uni, add }: { uni: string; add: (uni: string, mediaIds: string[]) => Promise<ActionState> }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function pick(files: FileList | null) {
    const list = [...(files ?? [])].slice(0, 30);
    if (list.length === 0) return;
    setErrors([]);
    setMessage(null);
    const ids: string[] = [];
    const failed: string[] = [];
    for (const [i, file] of list.entries()) {
      setProgress({ done: i, total: list.length });
      try {
        ids.push((await uploadImage(uni, "gallery", file)).id);
      } catch (e) {
        failed.push(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    if (ids.length) {
      const res = await add(uni, ids);
      if (res?.error) failed.push(res.error);
      else setMessage(res?.ok ?? null);
      startTransition(() => router.refresh());
    }
    setErrors(failed);
  }

  return (
    <div>
      <label className={cx(buttonClass("primary"), "cursor-pointer", progress && "pointer-events-none opacity-60")}>
        {progress ? `Uploading ${progress.done + 1} of ${progress.total}…` : "Upload photos"}
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
          className="sr-only"
          disabled={!!progress}
          onChange={(e) => pick(e.target.files)}
        />
      </label>
      <p className="mt-2 text-[12px] text-muted">JPG, PNG or WebP, up to 30 at a time. Large photos are resized for the web.</p>
      {message && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{message}</p>}
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
