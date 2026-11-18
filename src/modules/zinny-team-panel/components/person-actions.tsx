import { ActionLink } from "@/components/ui";
import { SignInAsButton } from "./sign-in-as-button";

/**
 * What a Super Admin can do from a person's row in a list: sign in as them in one click, or
 * open them. Editing their details and setting their password happen in one place, the
 * person's own page, instead of as two more forms on every row of every list.
 * Render it for Super Admins only; the actions check again. `self` is the Super Admin's own
 * row: nobody signs in as themselves.
 */
export function PersonActions({ userId, name, universityId, self }: { userId: string; name: string; universityId?: string | null; self?: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {!self && <SignInAsButton userId={userId} name={name} universityId={universityId} />}
      <ActionLink href={`/platform/people/${userId}`} aria-label={`Manage ${name}`}>
        Manage
      </ActionLink>
    </div>
  );
}
