import Link from "next/link";
import { buttonClass, cx } from "@/components/ui";
import { inspectResetToken } from "@/modules/identity/auth";
import { formatWhen } from "@/modules/identity/emails";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { Alert, NewPasswordForm } from "@/modules/identity/components/auth-forms";
import { resetCompleteAction } from "../../login/actions";

// The token is in the URL: never send it on to other sites, never cache the page.
export const metadata = { title: "Choose a new password", referrer: "no-referrer" as const, robots: { index: false } };
export const dynamic = "force-dynamic";

const ASK_AGAIN = (
  <Link href="/reset" className={cx(buttonClass("primary"), "h-11 w-full text-[15px]")}>
    Send a new reset link
  </Link>
);

export default async function ResetTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await inspectResetToken(token);

  if (link.state !== "valid") {
    const copy = {
      expired: ["This link has expired", "Reset links work for 30 minutes. Ask for a new one and use it straight away."],
      used: ["This link was already used", "Each reset link works once. If you didn't use it, ask for a new one."],
      invalid: ["This link isn't valid", "Check you opened the whole link from the email, or ask for a new one."],
    }[link.state];
    return (
      <AuthShell title={copy[0]}>
        <div className="space-y-5">
          <Alert tone="gold">{copy[1]}</Alert>
          {ASK_AGAIN}
          <p className="text-[14px] text-muted">
            <Link href="/login" className="text-brand hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={
        <>
          For <span className="font-medium text-ink">{link.email}</span>. This link works until {formatWhen(link.expiresAt)}. Saving signs you out on
          every other device.
        </>
      }
    >
      <NewPasswordForm
        action={resetCompleteAction}
        token={token}
        email={link.email}
        submitLabel="Save password and sign in"
        pendingText="Saving…"
        linkHelp={ASK_AGAIN}
      />
    </AuthShell>
  );
}
