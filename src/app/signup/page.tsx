import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUserId } from "@/server/auth/session";
import { loginUniversity } from "@/modules/identity/auth";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { InstituteCodeForm, SignUpForm } from "@/modules/identity/components/auth-forms";
import { UNI_COOKIE } from "@/modules/identity/cookies";
import { signUpAction } from "../login/actions";

export const metadata = { title: "Create your account", referrer: "strict-origin-when-cross-origin" as const };

/** Student sign-up, for one institute. Staff and parents are still added by the institute. */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ uni?: string }> }) {
  const sp = await searchParams;
  if (await currentUserId()) redirect("/");

  const jar = await cookies();
  // ?uni= first (empty means "not your institute"), then the institute this device last used.
  const code = (sp.uni !== undefined ? sp.uni : (jar.get(UNI_COOKIE)?.value ?? "")).trim();
  const university = await loginUniversity(code);
  const signInHref = university ? `/login?uni=${university.slug}` : "/login";
  const signIn = (
    <p className="mt-6 text-[14px] text-muted">
      Already have an account?{" "}
      <Link href={signInHref} className="font-medium text-brand hover:underline">
        Sign in
      </Link>
    </p>
  );

  if (!university) {
    return (
      <AuthShell title="Find your institute" subtitle="Student accounts belong to one institute. Enter its code to continue.">
        <InstituteCodeForm code={code} notFound={!!code} />
        {signIn}
      </AuthShell>
    );
  }

  if (!university.signupOpen) {
    return (
      <AuthShell title="Sign-up isn't open right now" subtitle={`${university.name} isn't taking new students here. Please contact the institute.`}>
        {signIn}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your student account"
      subtitle={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span>
            Joining <span className="font-medium text-ink">{university.name}</span>.
          </span>
          <Link href="/signup?uni=" className="text-[14px] text-brand hover:underline">
            Not your institute?
          </Link>
        </span>
      }
    >
      <SignUpForm action={signUpAction} uni={university.slug} signInHref={signInHref} />
      {signIn}
      <p className="mt-2 text-[13px] text-muted">Staff and parents are added by the institute.</p>
    </AuthShell>
  );
}
