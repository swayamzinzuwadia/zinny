"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { ButtonLabel, Input, Textarea, buttonClass, cx, inputClass, type ActionIconName, type ButtonVariant } from "@/components/ui";
import type { ActionState, FormAction } from "@/components/forms";
import { Grow } from "./motion";
import "./privacy.css";

function Submit({ children, icon, variant = "primary", size = "md", pendingText }: { children: string; icon?: ActionIconName | false; variant?: ButtonVariant; size?: "md" | "sm"; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
      {pending ? (
        <>
          <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          {pendingText ?? "Sending…"}
        </>
      ) : (
        <ButtonLabel icon={icon}>{children}</ButtonLabel>
      )}
    </button>
  );
}

function Message({ state }: { state: ActionState }) {
  if (state?.error)
    return (
      <p key={state.at} role="alert" className="dp-pop mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[14px] text-danger">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p key={state.at} role="status" className="dp-pop mt-3 rounded-xl bg-brand-soft px-3 py-2 text-[14px] text-brand-strong">
        {state.ok}
      </p>
    );
  return null;
}

/** One small button that posts a hidden value: "Withdraw", "Switch on", "Send a new link". */
export function OneTap({
  action,
  name,
  value,
  label,
  icon,
  variant = "quiet",
  extra,
}: {
  action: FormAction;
  name?: string;
  value?: string;
  label: string;
  icon?: ActionIconName | false;
  variant?: ButtonVariant;
  extra?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      {name && <input type="hidden" name={name} value={value} />}
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Submit icon={icon} variant={variant} size="sm" pendingText="Saving…">
        {label}
      </Submit>
      <Message state={state} />
    </form>
  );
}

const KINDS = [
  { key: "correction", label: "Correct something", hint: "Tell us what is wrong and what it should say." },
  { key: "erasure", label: "Erase my account", hint: "We anonymise your details and delete your KYC. Invoices stay: GST law needs them for 8 years." },
  { key: "nomination", label: "Name a nominee", hint: "Someone who can use these rights for you if you die or can't act yourself." },
  { key: "grievance", label: "Make a complaint", hint: "Anything about how your data is handled." },
] as const;

/** Asking for a correction, erasure, a nominee, or making a complaint. The fields grow in for the chosen kind. */
export function RequestForm({ action, defaultKind = "correction" }: { action: FormAction; defaultKind?: (typeof KINDS)[number]["key"] }) {
  const [state, formAction] = useActionState(action, null);
  const [kind, setKind] = useState<string>(defaultKind);
  const id = useId();
  const chosen = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  return (
    <form action={formAction} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">What would you like us to do?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label
              key={k.key}
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-[14px] transition-colors",
                kind === k.key ? "border-brand bg-brand-soft/60" : "border-line bg-surface hover:border-brand/40",
              )}
            >
              <input type="radio" name="kind" value={k.key} checked={kind === k.key} onChange={() => setKind(k.key)} className="accent-[var(--color-brand)]" />
              {k.label}
            </label>
          ))}
        </div>
        <p key={chosen.key} className="dp-pop mt-2 text-[13px] text-muted">
          {chosen.hint}
        </p>
      </fieldset>

      <Grow open={kind === "nomination"}>
        <div className="grid gap-3 pb-1 sm:grid-cols-2">
          <label className="block text-[14px] font-medium">
            Nominee&apos;s full name
            <Input name="nomineeName" autoComplete="off" className="mt-1.5" />
          </label>
          <label className="block text-[14px] font-medium">
            Relationship to you
            <Input name="nomineeRelation" placeholder="Mother, spouse, friend" autoComplete="off" className="mt-1.5" />
          </label>
          <label className="block text-[14px] font-medium sm:col-span-2">
            Their email or mobile number
            <Input name="nomineeContact" autoComplete="off" className="mt-1.5" />
          </label>
        </div>
      </Grow>

      <label htmlFor={`${id}-details`} className="block text-[14px] font-medium">
        {kind === "nomination" ? "Anything else (optional)" : kind === "erasure" ? "Why (optional)" : "Details"}
      </label>
      <Textarea id={`${id}-details`} name="details" rows={3} className="-mt-2" />

      <Grow open={kind === "erasure"}>
        <label className="flex gap-3 rounded-2xl border border-line bg-canvas p-3.5 text-[14px] leading-relaxed">
          <input type="checkbox" name="understand" value="yes" className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]" />
          <span>I understand my name, email, mobile number and KYC details will be removed and I will be signed out. GST invoices and a record of my consents stay, because the law requires them.</span>
        </label>
      </Grow>

      <Submit icon="send">{kind === "erasure" ? "Send erasure request" : "Send request"}</Submit>
      <Message state={state} />
    </form>
  );
}

/** "Are you under 18?" with the guardian's details growing in for a minor. Used on the privacy page and at sign-up. */
export function AgeFields({ required = false, formId }: { required?: boolean; formId?: string }) {
  const [age, setAge] = useState("");
  const id = useId();
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">Your age</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: "adult", t: "18 or older" },
            { v: "minor", t: "Under 18" },
          ].map((o) => (
            <label
              key={o.v}
              className={cx(
                "flex cursor-pointer items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-[14px] transition-colors",
                age === o.v ? "border-brand bg-brand-soft/60" : "border-line bg-surface hover:border-brand/40",
              )}
            >
              <input type="radio" name="age" form={formId} value={o.v} required={required} checked={age === o.v} onChange={() => setAge(o.v)} className="accent-[var(--color-brand)]" />
              {o.t}
            </label>
          ))}
        </div>
      </fieldset>
      <Grow open={age === "minor"}>
        <div className="space-y-3 rounded-2xl border border-gold/50 bg-gold-soft/40 p-3.5">
          <p className="text-[13px] text-ink">
            Indian law needs a parent or guardian&apos;s consent for learners under 18. We&apos;ll send them a link to confirm. Until they do, nothing that tracks how you learn is switched on.
          </p>
          <label className="block text-[14px] font-medium" htmlFor={`${id}-dob`}>
            Date of birth <span className="font-normal text-muted">(optional)</span>
          </label>
          <div className="-mt-2">
            <Input id={`${id}-dob`} type="date" name="birthDate" form={formId} />
          </div>
          <label className="block text-[14px] font-medium" htmlFor={`${id}-gname`}>
            Parent or guardian&apos;s full name
          </label>
          <input id={`${id}-gname`} name="guardianName" form={formId} autoComplete="off" className={cx(inputClass, "-mt-2 h-11")} />
          <label className="block text-[14px] font-medium" htmlFor={`${id}-gcontact`}>
            Their email or mobile number
          </label>
          <input id={`${id}-gcontact`} name="guardianContact" form={formId} autoComplete="off" placeholder="name@example.com or 98200 11001" className={cx(inputClass, "-mt-2 h-11")} />
        </div>
      </Grow>
    </div>
  );
}

export function AgeForm({ action }: { action: FormAction }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <AgeFields required />
      <Submit icon="check">Save my age</Submit>
      <Message state={state} />
    </form>
  );
}

/** The guardian's confirmation, on the page their link opens. */
export function GuardianConfirmForm({ action, learnerName }: { action: FormAction; learnerName: string }) {
  const [state, formAction] = useActionState(action, null);
  if (state?.ok)
    return (
      <p role="status" className="dp-pop rounded-2xl bg-brand-soft px-4 py-3 text-[15px] text-brand-strong">
        {state.ok} {learnerName} can now use Zinny fully. You can withdraw your consent any time by writing to the grievance officer below.
      </p>
    );
  return (
    <form action={formAction} className="space-y-4">
      <label className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-[15px] leading-relaxed">
        <input type="checkbox" name="agree" value="yes" className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
        <span>
          I am {learnerName}&apos;s parent or legal guardian, and I consent to Zinny and their institute processing {learnerName}&apos;s data as the privacy notice describes.
        </span>
      </label>
      <Submit icon="check" pendingText="Recording…">
        Give my consent
      </Submit>
      <Message state={state} />
    </form>
  );
}
