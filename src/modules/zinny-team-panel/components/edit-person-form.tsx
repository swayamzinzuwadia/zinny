import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { updatePersonAction } from "../actions";

/**
 * "Edit" for one user: name, email and mobile. Super Admins only (the action checks again).
 * It opens under the button, like Set password, so it works in a list row and on the page.
 */
export function EditPersonForm({ userId, name, email, phone, compact }: { userId: string; name: string; email: string; phone: string | null; compact?: boolean }) {
  return (
    <details className="group">
      <summary
        className={
          compact
            ? "inline-flex h-8 cursor-pointer list-none items-center whitespace-nowrap text-[13px] text-brand hover:underline"
            : "inline-flex h-10 cursor-pointer list-none items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40"
        }
      >
        Edit
      </summary>
      <ActionForm action={updatePersonAction} className="mt-3 w-80 max-w-full space-y-3 rounded-2xl border border-line bg-surface p-4 text-left">
        <input type="hidden" name="userId" value={userId} />
        <Field label="Name">
          <Input name="name" defaultValue={name} required minLength={2} maxLength={120} autoComplete="off" />
        </Field>
        <Field label="Email" hint="They sign in with this. It must not belong to another account.">
          <Input name="email" type="email" defaultValue={email} required autoComplete="off" />
        </Field>
        <Field label="Mobile" hint="Leave empty to remove it. Ten-digit numbers are saved as +91.">
          <Input name="phone" type="tel" defaultValue={phone ?? ""} autoComplete="off" />
        </Field>
        <p className="text-[12.5px] text-muted">Logged in the platform log and the institute&apos;s log with what changed.</p>
        <SubmitButton pendingText="Saving…">Save details</SubmitButton>
      </ActionForm>
    </details>
  );
}
