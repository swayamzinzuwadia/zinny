"use client";
/**
 * The student sign-up form with the consent boxes and the age question (privacy module). The
 * fields belong to identity's form through the HTML `form` attribute, and sit just above its
 * "Create my account" button.
 */
import { useEffect, useId, useRef, type ComponentProps } from "react";
import { SignUpForm } from "@/modules/identity/components/auth-forms";
import { AgeFields } from "@/modules/privacy/components/forms";

const BOXES = [
  { name: "consent_account", text: "Zinny may use my name, email and mobile number to create my account and sign me in.", required: true },
  { name: "consent_service", text: "My institute and Zinny may process my learning records (courses, attendance, tests, payments) to teach me and run my courses.", required: true },
  { name: "consent_marketing", text: "Send me news about new courses and offers.", required: false },
] as const;

export function StudentSignUp(props: ComponentProps<typeof SignUpForm>) {
  const wrap = useRef<HTMLDivElement>(null);
  const formId = useId().replace(/:/g, "");
  useEffect(() => {
    const form = wrap.current?.querySelector("form");
    if (form) form.id = formId;
  }, [formId]);

  return (
    <div ref={wrap} className="dp-signup">
      <SignUpForm {...props} />
      <div className="dp-signup-extra space-y-4" role="group" aria-label="Age and consent">
        <AgeFields required formId={formId} />
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[14px] font-medium">Your consent</legend>
          {BOXES.map((b) => (
            <label key={b.name} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 text-[13px] leading-relaxed">
              <input type="checkbox" name={b.name} value="yes" form={formId} required={b.required} className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" />
              <span>
                {b.text} <span className="text-muted">{b.required ? "Needed" : "Optional"}</span>
              </span>
            </label>
          ))}
          <p className="text-[12px] text-muted">
            Read the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
              privacy notice
            </a>
            . You can withdraw consent to news any time.
          </p>
        </fieldset>
      </div>
    </div>
  );
}
