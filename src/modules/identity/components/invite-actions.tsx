"use client";
/**
 * Resend and Revoke for one row of the invitations page. Renders two grid items: the
 * buttons, and (after an action) a message that spans the whole row, so a long message
 * never squeezes the columns.
 */
import { useActionState } from "react";
import { SubmitButton, type FormAction } from "@/components/forms";
import { cx } from "@/components/ui";

export function InviteActions({
  uni,
  userId,
  inviteId,
  name,
  primary,
  label,
  resend,
  revoke,
}: {
  uni: string;
  userId: string;
  inviteId: string | null;
  name: string;
  /** Resend is the main action when the link expired or was never sent. */
  primary: boolean;
  label: string;
  resend: FormAction;
  revoke: FormAction;
}) {
  const [sent, resendAction] = useActionState(resend, null);
  const [revoked, revokeAction] = useActionState(revoke, null);
  const latest = [sent, revoked].filter((x) => !!x).sort((a, b) => (b!.at ?? 0) - (a!.at ?? 0))[0] ?? null;
  return (
    <>
      <div className="flex flex-wrap items-start gap-2 sm:col-start-2 sm:row-start-1 sm:justify-end lg:col-start-auto lg:row-start-auto">
        <form action={resendAction}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="userId" value={userId} />
          <SubmitButton size="sm" variant={primary ? "primary" : "secondary"} pendingText="Sending…">
            {label}
          </SubmitButton>
        </form>
        {inviteId && (
          <form
            action={revokeAction}
            onSubmit={(e) => {
              if (!window.confirm(`Revoke the invitation for ${name}? The link stops working. They keep their role until you remove it under Users.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="inviteId" value={inviteId} />
            <SubmitButton size="sm" variant="danger" pendingText="Revoking…">
              Revoke
            </SubmitButton>
          </form>
        )}
      </div>
      {latest && (
        <p
          role={latest.error ? "alert" : "status"}
          aria-live="polite"
          className={cx("col-span-full rounded-xl px-3 py-2 text-[13px]", latest.error ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-strong")}
        >
          {latest.error ?? latest.ok}
        </p>
      )}
    </>
  );
}
