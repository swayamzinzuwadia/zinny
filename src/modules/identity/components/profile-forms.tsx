"use client";
/** Client pieces of the profile page: the photo picker, the phone change steps and confirm buttons. */
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState, FormAction } from "@/components/forms";
import { buttonClass, cx, inputClass } from "@/components/ui";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      aria-live="polite"
      className={cx("mt-3 rounded-xl px-3 py-2 text-[14px]", state.error ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-strong")}
    >
      {state.error ?? state.ok}
    </p>
  );
}

function Submit({ children, pendingText, variant = "primary", size = "md" }: { children: ReactNode; pendingText: string; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "md" | "sm" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
      {pending ? pendingText : children}
    </button>
  );
}

/* ───────────────────────────── Photo ───────────────────────────── */

/** Largest side sent to the server; it crops to 512 px anyway. */
const MAX_SIDE = 1024;
const MAX_PICK_BYTES = 15 * 1024 * 1024;

/** Shrinks a photo in the browser so it fits the server's upload limit. Null when the browser can't read it. */
async function shrink(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
  } catch {
    return null;
  }
}

export function PhotoForm({ uni, upload, remove, hasPhoto }: { uni: string; upload: FormAction; remove: FormAction; hasPhoto: boolean }) {
  const [uploaded, uploadAction, uploading] = useActionState(upload, null);
  const [removed, removeAction] = useActionState(remove, null);
  const [localError, setLocalError] = useState<{ error: string; at: number } | null>(null);
  const [reading, startReading] = useTransition();
  const busy = uploading || reading;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_PICK_BYTES) {
      setLocalError({ error: "That photo is too large. Choose one under 15 MB.", at: Date.now() });
      return;
    }
    setLocalError(null);
    startReading(async () => {
      const small = await shrink(file);
      if (!small) {
        setLocalError({ error: "Your browser can't read that file. Choose a JPG or PNG photo.", at: Date.now() });
        return;
      }
      const data = new FormData();
      data.set("uni", uni);
      data.set("photo", new File([small], "photo.jpg", { type: "image/jpeg" }));
      uploadAction(data);
    });
  }

  // Show whichever happened last.
  const latest = [localError, uploaded, removed].filter(Boolean).sort((a, b) => (b!.at ?? 0) - (a!.at ?? 0))[0] ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          id="photo-input"
          onChange={onPick}
          disabled={busy}
        />
        <label htmlFor="photo-input" className={cx(buttonClass("secondary", "sm"), "cursor-pointer", busy && "pointer-events-none opacity-50")}>
          {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Add a photo"}
        </label>
        {hasPhoto && (
          <form
            action={removeAction}
            onSubmit={(e) => {
              if (!window.confirm("Remove your photo? Your initials show instead.")) e.preventDefault();
            }}
          >
            <input type="hidden" name="uni" value={uni} />
            <Submit pendingText="Removing…" variant="ghost" size="sm">
              Remove photo
            </Submit>
          </form>
        )}
      </div>
      <p className="mt-2 text-[12px] text-muted">A JPG or PNG of your face works best. We crop it to a square.</p>
      <Result state={latest} />
    </div>
  );
}

/* ───────────────────────────── Mobile number ───────────────────────────── */

export function PhoneChange({
  uni,
  current,
  pending,
  start,
  verify,
  resend,
  cancel,
  remove,
}: {
  uni: string;
  current: string | null;
  pending: { masked: string; resendAt: number; expiresAt: number; attemptsLeft: number } | null;
  start: FormAction;
  verify: FormAction;
  resend: FormAction;
  cancel: (data: FormData) => Promise<void>;
  remove: FormAction;
}) {
  const [editing, setEditing] = useState(!current);
  const [started, startAction] = useActionState(start, null);
  const [resent, resendAction] = useActionState(resend, null);
  const [verified, verifyAction] = useActionState(verify, null);
  const [removed, removeAction] = useActionState(remove, null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (verified?.ok) setEditing(false);
  }, [verified]);

  if (pending && !verified?.ok) {
    const wait = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));
    const left = Math.max(0, Math.ceil((pending.expiresAt - now) / 1000));
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-muted">
          Enter the 6-digit code we sent to <span className="font-medium text-ink">{pending.masked}</span>.{" "}
          <span className="tabular">{left > 0 ? `It expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.` : "It has expired."}</span>
        </p>
        <form action={verifyAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="uni" value={uni} />
          <input
            key={verified?.at ?? 0}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            aria-label="Code"
            placeholder="6-digit code"
            autoFocus
            className={cx(inputClass, "tabular w-40 text-center text-[16px] tracking-[0.25em]")}
          />
          <Submit pendingText="Checking…">Confirm number</Submit>
        </form>
        <Result state={[verified, resent].filter(Boolean).sort((a, b) => (b!.at ?? 0) - (a!.at ?? 0))[0] ?? null} />
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          {wait > 0 ? (
            <span className="tabular text-muted">You can ask for a new code in {wait} s.</span>
          ) : (
            <form action={resendAction}>
              <input type="hidden" name="uni" value={uni} />
              <button className="font-medium text-brand hover:underline">Send a new code</button>
            </form>
          )}
          <form action={cancel}>
            <input type="hidden" name="uni" value={uni} />
            <button className="font-medium text-brand hover:underline">Cancel</button>
          </form>
        </div>
      </div>
    );
  }

  if (!editing && current) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="tabular font-medium">{current}</div>
          <div className="text-[13px] text-muted">Used for sign-in codes and class alerts.</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className={buttonClass("secondary", "sm")}>
            Change number
          </button>
          <form
            action={removeAction}
            onSubmit={(e) => {
              if (!window.confirm("Remove your mobile number? You won't be able to sign in with a code.")) e.preventDefault();
            }}
          >
            <input type="hidden" name="uni" value={uni} />
            <Submit pendingText="Removing…" variant="ghost" size="sm">
              Remove
            </Submit>
          </form>
        </div>
        <div className="w-full">
          <Result state={verified?.ok ? verified : removed} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <form action={startAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="uni" value={uni} />
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98200 11001"
          required
          aria-label="New mobile number"
          className={cx(inputClass, "w-full min-w-0 flex-1 sm:w-auto")}
        />
        <Submit pendingText="Sending code…">Send code</Submit>
        {current && (
          <button type="button" onClick={() => setEditing(false)} className={buttonClass("ghost")}>
            Cancel
          </button>
        )}
      </form>
      <p className="mt-2 text-[12px] text-muted">We text a code to the new number to check it&apos;s yours. It&apos;s saved once you enter the code.</p>
      <Result state={started?.error ? started : removed} />
    </div>
  );
}

/* ───────────────────────────── Confirm button ───────────────────────────── */

/** A one-button form that asks before it runs (signing out a device, revoking an invitation). */
export function ConfirmButton({
  action,
  fields,
  confirm,
  children,
  pendingText,
  variant = "secondary",
  size = "sm",
}: {
  action: FormAction;
  fields: Record<string, string>;
  confirm: string;
  children: ReactNode;
  pendingText: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm";
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Submit pendingText={pendingText} variant={variant} size={size}>
        {children}
      </Submit>
      {state?.error && <p className="mt-2 max-w-xs text-[13px] text-danger" role="alert">{state.error}</p>}
    </form>
  );
}

/** A plain form that asks before it submits (for actions that redirect, like signing out everywhere). */
export function ConfirmForm({ action, fields, confirm, children, className }: { action: (data: FormData) => Promise<void>; fields: Record<string, string>; confirm: string; children: ReactNode; className?: string }) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
    </form>
  );
}
