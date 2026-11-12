import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { PASSWORD_MIN } from "@/server/auth/passwords";
import { setPasswordAction } from "../actions";

/**
 * "Set password" for one person. Super Admins only (the action checks again). The
 * password is never shown again or logged, so the form says to pass it on safely.
 */
export function SetPasswordForm({ userId, name, compact }: { userId: string; name: string; compact?: boolean }) {
  return (
    <details className="group">
      <summary
        className={
          compact
            ? "inline-flex h-8 cursor-pointer list-none items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium hover:border-brand/40"
            : "inline-flex h-10 cursor-pointer list-none items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40"
        }
      >
        Set password
      </summary>
      <ActionForm action={setPasswordAction} className="mt-3 space-y-3 rounded-2xl border border-line bg-surface p-4 text-left" confirm={`Set a new password for ${name}?`}>
        <input type="hidden" name="userId" value={userId} />
        <Field label={`New password for ${name}`} hint={`At least ${PASSWORD_MIN} characters. Common passwords are refused.`}>
          <Input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} />
        </Field>
        <Field label="Type it again">
          <Input name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} />
        </Field>
        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="checkbox" name="signOutEverywhere" defaultChecked className="mt-1 h-4 w-4 accent-[#0b5e4c]" />
          <span>
            <span className="font-medium">Sign them out everywhere</span>
            <span className="block text-[13px] text-muted">Ends every session they have open, so only the new password gets in.</span>
          </span>
        </label>
        <p className="text-[12.5px] text-muted">Logged in the platform log and the institute&apos;s log with your name. The password itself is never stored in the log or shown again.</p>
        <SubmitButton pendingText="Setting…">Set password</SubmitButton>
      </ActionForm>
    </details>
  );
}
