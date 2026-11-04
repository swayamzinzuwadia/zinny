import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/server/auth/session";
import { loginUniversity } from "@/modules/identity/auth";
import { findInstituteByCode } from "@/modules/identity/joining";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { InstituteCodeForm, SignUpForm } from "@/modules/identity/components/auth-forms";
import { signUpAction } from "../login/actions";

export const metadata = { title: "Create your account", referrer: "strict-origin-when-cross-origin" as const };

/**
 * Student sign-up.
 *  - On its own it makes a marketplace account, which belongs to no institute. The learner
 *    can join an institute later from /join.
 *  - With ?code= (an institute's joining code) the account joins that institute, straight
 *    away or with a join request, as the institute chooses.
 *  - ?uni= is the institute's own website linking here; it works like a code.
 * Staff and parents are still added by the institute.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ uni?: string; code?: string; join?: string }> }) {
  const sp = await searchParams;
  if (await currentUserId()) redirect("/");

  const code = (sp.code ?? "").trim();
  const slug = (sp.uni ?? "").trim();
  const byCode = code ? await findInstituteByCode(code) : null;
  const bySlug = !code && slug ? await loginUniversity(slug) : null;
  const signInHref = bySlug ? `/login?uni=${bySlug.slug}` : byCode ? `/login?uni=${byCode.slug}` : "/login";
  const signIn = (
    <p className="mt-6 text-[14px] text-muted">
      Already have an account?{" "}
      <Link href={signInHref} className="font-medium text-brand hover:underline">
        Sign in
      </Link>
    </p>
  );

  if (!code && !slug && sp.join === undefined) {
    return (
      <AuthShell title="Create a free account" subtitle="Buy recorded courses and lectures from institutes on Zinny, and watch them at your own pace.">
        {/* Students of an institute need its joining code, so that way in comes before the form. */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px]">
          <span>Studying at an institute on Zinny?</span>
          <Link href="/signup?join=1" className="font-medium text-brand hover:underline">
            Use your joining code
          </Link>
        </div>
        <SignUpForm action={signUpAction} uni="" signInHref={signInHref} />
        {signIn}
      </AuthShell>
    );
  }

  if (byCode) {
    return (
      <AuthShell
        title="Create your student account"
        subtitle={
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span>
              Joining <span className="font-medium text-ink">{byCode.name}</span>.{" "}
              {byCode.joinMode === "approval" ? "They accept each new student; you can use the marketplace while you wait." : "You'll join straight away."}
            </span>
            <Link href="/signup?join=1" className="text-[14px] text-brand hover:underline">
              Not your institute?
            </Link>
          </span>
        }
      >
        <SignUpForm action={signUpAction} uni="" code={byCode.code} departments={byCode.departments} signInHref={signInHref} />
        {signIn}
        <p className="mt-2 text-[13px] text-muted">Staff and parents are added by the institute.</p>
      </AuthShell>
    );
  }

  if (!bySlug) {
    return (
      <AuthShell title="Join your institute" subtitle="Enter the joining code your institute gave you.">
        <InstituteCodeForm code={code || slug} notFound={!!(code || slug)} />
        {signIn}
        <p className="mt-2 text-[14px] text-muted">
          Not with an institute?{" "}
          <Link href="/signup" className="text-brand hover:underline">
            Create a free account
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (!bySlug.signupOpen) {
    return (
      <AuthShell title="Sign-up isn't open right now" subtitle={`${bySlug.name} isn't taking new students here. Please contact the institute.`}>
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
            Joining <span className="font-medium text-ink">{bySlug.name}</span>.
          </span>
          <Link href="/signup?join=1" className="text-[14px] text-brand hover:underline">
            Not your institute?
          </Link>
        </span>
      }
    >
      <SignUpForm action={signUpAction} uni={bySlug.slug} signInHref={signInHref} />
      {signIn}
      <p className="mt-2 text-[13px] text-muted">Staff and parents are added by the institute.</p>
    </AuthShell>
  );
}
