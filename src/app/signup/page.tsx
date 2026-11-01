import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/server/auth/session";
import { loginUniversity } from "@/modules/identity/auth";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { InstituteCodeForm, SignUpForm } from "@/modules/identity/components/auth-forms";
import { signUpAction } from "../login/actions";

export const metadata = { title: "Create your account", referrer: "strict-origin-when-cross-origin" as const };

/**
 * Student sign-up. On its own it creates a marketplace account, which belongs to no
 * institute; with ?uni= it joins that institute, if it takes sign-ups. Staff and parents
 * are still added by the institute.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ uni?: string; join?: string }> }) {
  const sp = await searchParams;
  if (await currentUserId()) redirect("/");

  const code = (sp.uni ?? "").trim();
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

  if (!code && sp.join === undefined) {
    return (
      <AuthShell title="Create your account" subtitle="Buy recorded courses and lectures from institutes on Zinny, and watch them at your own pace.">
        <SignUpForm action={signUpAction} uni="" signInHref={signInHref} />
        {signIn}
        <p className="mt-2 text-[14px] text-muted">
          Your institute uses Zinny?{" "}
          <Link href="/signup?join=1" className="text-brand hover:underline">
            Join it with its code
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (!university) {
    return (
      <AuthShell title="Find your institute" subtitle="Enter your institute's code to join it as a student.">
        <InstituteCodeForm code={code} notFound={!!code} />
        {signIn}
        <p className="mt-2 text-[14px] text-muted">
          Not with an institute?{" "}
          <Link href="/signup" className="text-brand hover:underline">
            Create a marketplace account
          </Link>
        </p>
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
          <Link href="/signup?join=1" className="text-[14px] text-brand hover:underline">
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
