import { AuthShell } from "@/modules/identity/components/auth-shell";
import { ResetRequestForm } from "@/modules/identity/components/auth-forms";
import { resetRequestAction } from "../login/actions";

export const metadata = { title: "Reset your password", referrer: "no-referrer" as const };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthShell title="Reset your password">
      <ResetRequestForm action={resetRequestAction} defaultEmail={email?.slice(0, 200)} />
    </AuthShell>
  );
}
