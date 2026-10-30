import { ActionForm, SubmitButton } from "@/components/forms";
import { buttonClass } from "@/components/ui";
import { openInstituteAction } from "../actions";

/**
 * One click into an institute's admin panel, for Super Admins. It opens a support session,
 * so the gold banner, the 2-hour limit and the activity log all still apply.
 */
export function OpenInstitute({ universityId, slug, inside, variant = "primary" }: { universityId: string; slug: string; inside: boolean; variant?: "primary" | "secondary" }) {
  if (inside) {
    return (
      <a href={`/${slug}/admin`} className={buttonClass(variant, "sm")}>
        Back to dashboard
      </a>
    );
  }
  return (
    <ActionForm action={openInstituteAction} resetOnSuccess={false} className="inline-block">
      <input type="hidden" name="universityId" value={universityId} />
      <SubmitButton size="sm" variant={variant} pendingText="Opening…">
        Open dashboard
      </SubmitButton>
    </ActionForm>
  );
}
