import Link from "next/link";
import { buttonClass, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { inspectInvite } from "@/modules/identity/auth";
import { formatWhen } from "@/modules/identity/emails";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { Alert, NewPasswordForm } from "@/modules/identity/components/auth-forms";
import { acceptInviteAction } from "../../login/actions";

// The token is in the URL: never send it on to other sites, never cache the page.
export const metadata = { title: "Join your institute", referrer: "no-referrer" as const, robots: { index: false } };
export const dynamic = "force-dynamic";

const SIGN_IN = (email?: string) => (
  <Link href={email ? `/login?email=${encodeURIComponent(email)}` : "/login"} className={cx(buttonClass("primary"), "h-11 w-full text-[15px]")}>
    Go to sign in
  </Link>
);

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inspectInvite(token);

  if (invite.state !== "valid") {
    const institute = "institute" in invite ? invite.institute : "your institute";
    const email = "email" in invite ? invite.email : undefined;
    const copy: Record<typeof invite.state, [string, string, React.ReactNode]> = {
      expired: ["This invitation has expired", `Invitations work for 7 days. Ask ${institute} to send you a new one, then use the link in that email.`, SIGN_IN()],
      revoked: ["This invitation was cancelled", `${institute} cancelled this invitation. If you think that's a mistake, contact them.`, SIGN_IN()],
      replaced: ["A newer invitation was sent", `${institute} sent you a newer invitation, so this link no longer works. Use the link in the latest email.`, SIGN_IN()],
      no_access: ["This invitation can't be used", `You no longer have a role at ${institute}. Contact them if you think that's a mistake.`, SIGN_IN()],
      accepted: ["You've already joined", "You've used this invitation and set your password. Sign in with your email and password.", SIGN_IN(email)],
      has_password: ["You already have a password", "Your Zinny account already has a password. Sign in with it, or reset it if you've forgotten it.", SIGN_IN(email)],
      invalid: ["This invitation link isn't valid", "Check you opened the whole link from the email. If it still doesn't work, ask your institute for a new invitation.", SIGN_IN()],
    };
    const [title, body, cta] = copy[invite.state];
    return (
      <AuthShell title={title}>
        <div className="space-y-5">
          <Alert tone="gold">{body}</Alert>
          {cta}
          <p className="text-[14px] text-muted">
            Forgotten your password?{" "}
            <Link href="/reset" className="text-brand hover:underline">
              Reset it
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  const signedInAs = await currentUserId();
  const first = invite.name.split(/\s+/)[0];
  return (
    <AuthShell
      title={invite.slug ? `Join ${invite.institute}` : "Join the Zinny team"}
      subtitle={
        <>
          Welcome, {first}. {invite.slug ? `${invite.institute} has added you as ${invite.roleLabel}.` : `You've been added as ${invite.roleLabel}.`} Choose a
          password to finish setting up your account.
        </>
      }
    >
      <div className="mb-5 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px]">
        <div className="text-muted">Your sign-in email</div>
        <div className="font-medium break-all">{invite.email}</div>
      </div>
      {signedInAs && signedInAs !== invite.userId && (
        <div className="mb-5">
          <Alert tone="gold">You&apos;re signed in as someone else on this device. Setting this password signs you in as {invite.name} instead.</Alert>
        </div>
      )}
      <NewPasswordForm
        action={acceptInviteAction}
        token={token}
        email={invite.email}
        submitLabel="Set password and sign in"
        pendingText="Setting up your account…"
        linkHelp={SIGN_IN()}
      />
      <p className="mt-5 text-[13px] text-muted">This link works once, until {formatWhen(invite.expiresAt)}.</p>
    </AuthShell>
  );
}
