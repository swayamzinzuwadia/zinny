"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonClass, cx } from "@/components/ui";
import type { MediaKind } from "../schema";
import { uploadImage } from "./upload";

/**
 * An image picker inside a form: uploads straight away, previews, and puts the new image's
 * id in a hidden input (`name`). "Remove" clears it. Saving the form attaches the image.
 */
export function ImageField({
  uni,
  kind,
  name,
  label,
  hint,
  initial,
  shape = "wide",
  removable = true,
}: {
  uni: string;
  kind: MediaKind;
  name: string;
  label: string;
  hint?: string;
  initial: { id: string; src: string } | null;
  shape?: "wide" | "square" | "logo";
  removable?: boolean;
}) {
  const [image, setImage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const id = useId();

  // When the surrounding form resets (after "Add …" succeeds), start again from the initial image.
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const onReset = () => {
      setImage(initial);
      setError(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initial]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const up = await uploadImage(uni, kind, file);
      setImage({ id: up.id, src: up.src });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const box =
    shape === "square" ? "h-28 w-28 rounded-full" : shape === "logo" ? "h-24 w-24 rounded-2xl" : "aspect-[16/9] w-full max-w-[360px] rounded-2xl";

  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium" id={`${id}-label`}>
        {label}
      </span>
      <input ref={hidden} type="hidden" name={name} value={image?.id ?? ""} />
      <div className="flex flex-wrap items-end gap-4">
        <div className={cx("relative shrink-0 overflow-hidden border border-line bg-canvas", box)}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.src} alt="" className={cx("h-full w-full", shape === "logo" ? "object-contain p-2" : "object-cover")} />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[12px] text-faint">No image yet</span>
          )}
          {busy && <span className="absolute inset-0 flex items-center justify-center bg-surface/80 text-[12px] text-muted">Uploading…</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={cx(buttonClass("secondary", "sm"), "cursor-pointer", busy && "pointer-events-none opacity-50")}>
            {image ? "Replace image" : "Upload image"}
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif"
              className="sr-only"
              aria-labelledby={`${id}-label`}
              disabled={busy}
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </label>
          {image && removable && (
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setImage(null)} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>
      {hint && !error && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1.5 block text-[12px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
