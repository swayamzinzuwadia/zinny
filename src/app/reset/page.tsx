import Link from "next/link";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { ResetRequestForm } from "@/modules/identity/components/auth-forms";
import { resetRequestAction } from "../login/actions";

export const metadata = { title: "Reset your password", referrer: "no-referrer" as const };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you sign in with. We'll send you a link to choose a new password."
      footer={
        <p className="text-[14px] text-muted">
          Remembered it?{" "}
          <Link href="/login" className="text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <ResetRequestForm action={resetRequestAction} defaultEmail={email?.slice(0, 200)} />
    </AuthShell>
  );
}
