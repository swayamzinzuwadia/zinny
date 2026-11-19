"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { ButtonLabel, buttonClass, cx, inputClass } from "@/components/ui";
import type { ActionState } from "@/components/forms";
import { Grow } from "./motion";
import "./motion.css";

const field = cx(inputClass, "h-12 text-[16px] tracking-wide");

function Save({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "h-12 w-full text-[15px]")}>
      {pending ? "Saving…" : <ButtonLabel icon="check">{again ? "Update my KYC" : "Save my KYC"}</ButtonLabel>}
    </button>
  );
}

/**
 * The student's KYC form, mobile first. The Aadhaar box takes 4 digits and nothing more, and
 * says so as soon as someone starts typing a full number, before anything is sent.
 */
export function KycForm({ action, again, notice }: { action: (prev: ActionState, data: FormData) => Promise<ActionState>; again: boolean; notice: string }) {
  const [state, formAction] = useActionState(action, null);
  const id = useId();
  const [aadhaar, setAadhaar] = useState("");
  const tooLong = aadhaar.replace(/\D/g, "").length > 4;

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor={`${id}-pan`} className="mb-1.5 block text-[14px] font-medium">
          PAN
        </label>
        <input
          id={`${id}-pan`}
          name="pan"
          required
          maxLength={10}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCDE1234F"
          pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]"
          title="5 letters, 4 digits, then a letter"
          className={cx(field, "uppercase")}
        />
        <p className="mt-1.5 text-[12px] text-muted">10 characters: 5 letters, 4 digits, then a letter.</p>
      </div>

      <div>
        <label htmlFor={`${id}-aadhaar`} className="mb-1.5 flex items-baseline justify-between text-[14px] font-medium">
          Last 4 digits of your Aadhaar
          <span className="text-[12px] font-normal text-muted">Optional</span>
        </label>
        <input
          id={`${id}-aadhaar`}
          name="aadhaar"
          inputMode="numeric"
          autoComplete="off"
          maxLength={14}
          placeholder="1234"
          value={aadhaar}
          onChange={(e) => setAadhaar(e.target.value)}
          aria-invalid={tooLong}
          className={cx(field, "tabular", tooLong && "border-danger")}
        />
        <Grow open={tooLong}>
          <p role="alert" className="pt-1.5 text-[13px] text-danger">
            Enter only the last 4 digits. We never take or keep your full Aadhaar number.
          </p>
        </Grow>
      </div>

      <label className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-[14px] leading-relaxed">
        <input type="checkbox" name="consent" value="yes" required className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
        <span>{notice}</span>
      </label>

      {state?.error && (
        <p role="alert" className="onb-pop rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="onb-pop rounded-xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">
          {state.ok}
        </p>
      )}
      <Save again={again} />
    </form>
  );
}
