import { SetPasswordForm } from "./set-password-form";
import { SignInAsButton } from "./sign-in-as-button";

/**
 * What a Super Admin can do to one account, wherever a person appears in the panel:
 * set their password, and sign in as them. Render it for Super Admins only; the actions
 * check again. `self` is the Super Admin's own row: nobody signs in as themselves.
 */
export function PersonActions({ userId, name, universityId, self }: { userId: string; name: string; universityId?: string | null; self?: boolean }) {
  return (
    <div className="flex items-start justify-end gap-4">
      {!self && <SignInAsButton userId={userId} name={name} universityId={universityId} />}
      <SetPasswordForm userId={userId} name={name} compact />
    </div>
  );
}
