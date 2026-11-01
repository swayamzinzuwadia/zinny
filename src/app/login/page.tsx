import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buttonClass, cx } from "@/components/ui";
import { demoEnabled } from "@/server/auth/config";
import { currentUserId } from "@/server/auth/session";
import { availableDemoAccounts, loginUniversity, phoneSignInView, safeNext, slugFromNext } from "@/modules/identity/auth";
import { AuthShell, AuthTabs } from "@/modules/identity/components/auth-shell";
import { DemoButton, PasswordSignInForm, PhoneChooseForm, PhoneCodeForm, PhoneNumberForm } from "@/modules/identity/components/auth-forms";
import { PHONE_COOKIE, UNI_COOKIE } from "@/modules/identity/cookies";
import {
  demoSignInAction,
  forgetUniversityAction,
  passwordSignInAction,
  phoneChooseAction,
  phoneResendAction,
  phoneRestartAction,
  phoneSendAction,
  phoneVerifyAction,
} from "./actions";

export const metadata = { title: "Sign in", referrer: "strict-origin-when-cross-origin" as const };

type Search = { next?: string; uni?: string; tab?: string; email?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next) ?? "/";
  if (await currentUserId()) redirect(next);

  const jar = await cookies();
  // Which institute: ?uni= first (empty means "not your institute"), then the place
  // you were going to, then the institute this device last signed in to.
  const slug = sp.uni !== undefined ? sp.uni : (slugFromNext(sp.next) ?? jar.get(UNI_COOKIE)?.value ?? null);
  const university = await loginUniversity(slug);
  const phoneOn = !!university?.phoneSignIn;
  const tab = phoneOn && sp.tab === "phone" ? "phone" : "email";
  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(university ? { uni: university.slug } : {}), ...(next !== "/" ? { next } : {}), ...extra });
    const s = q.toString();
    return `/login${s ? `?${s}` : ""}`;
  };
  const view = tab === "phone" ? await phoneSignInView(jar.get(PHONE_COOKIE)?.value) : null;
  // A phone sign-in started at another institute isn't continued here.
  const phone = view && view.universityId === university?.id ? view : null;
  const demoAccounts = demoEnabled() && !phone ? await availableDemoAccounts() : [];

  const title = phone?.step === "code" ? "Enter your code" : phone?.step === "choose" ? "Choose your account" : university ? "Sign in to your institute" : "Sign in to Zinny";
  const subtitle = university ? (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>
        Signing in to <span className="font-medium text-ink">{university.name}</span>.
      </span>
      <form action={forgetUniversityAction} className="inline">
        <input type="hidden" name="next" value={next} />
        <button className="text-[14px] text-brand hover:underline">Not your institute?</button>
      </form>
    </span>
  ) : (
    "Use the email on your Zinny account."
  );

  return (
    <AuthShell
      title={title}
      subtitle={phone ? undefined : subtitle}
      footer={
        demoAccounts.length > 0 ? (
          <div className="rounded-[22px] border border-line bg-surface p-5">
            <p className="font-medium">Try a demo account</p>
            <p className="mb-3 text-[13px] text-muted">Each one shows Zinny as that role sees it. Password for all: zinny123</p>
            {/* While one account signs in, the others can't be clicked. */}
            <div className="grid gap-1 has-[button:disabled]:pointer-events-none">
              {demoAccounts.map(([group, email, label]) => (
                <form key={email} action={demoSignInAction}>
                  <input type="hidden" name="email" value={email} />
                  <DemoButton label={label} group={group} />
                </form>
              ))}
            </div>
          </div>
        ) : undefined
      }
    >
      {phoneOn && !phone && (
        <AuthTabs
          active={tab}
          tabs={[
            { key: "email", label: "Email", href: query({}) },
            { key: "phone", label: "Mobile number", href: query({ tab: "phone" }) },
          ]}
        />
      )}

      {tab === "email" && <PasswordSignInForm action={passwordSignInAction} next={next} defaultEmail={sp.email} resetHref="/reset" />}

      {tab === "phone" && university && !phone && <PhoneNumberForm action={phoneSendAction} uni={university.slug} next={next} />}

      {tab === "phone" && university && phone?.step === "code" && (
        <PhoneCodeForm
          verify={phoneVerifyAction}
          resend={phoneResendAction}
          restart={phoneRestartAction}
          uni={university.slug}
          next={next}
          masked={phone.masked}
          resendAt={phone.resendAt.getTime()}
          expiresAt={phone.expiresAt.getTime()}
          attemptsLeft={phone.attemptsLeft}
          sendsLeft={phone.sendsLeft}
        />
      )}

      {tab === "phone" && university && phone?.step === "choose" && (
        <PhoneChooseForm action={phoneChooseAction} uni={university.slug} next={next} accounts={phone.accounts} />
      )}

      {!phone && (
        <div className="mt-7">
          {(!university || university.signupOpen) && (
            <>
              <div className="mb-4 flex items-center gap-3 text-[13px] text-muted">
                <span aria-hidden className="h-px flex-1 bg-line" />
                New to Zinny?
                <span aria-hidden className="h-px flex-1 bg-line" />
              </div>
              <Link href={university ? `/signup?uni=${university.slug}` : "/signup"} className={cx(buttonClass("secondary"), "w-full")}>
                Create a student account
              </Link>
            </>
          )}
          <p className="mt-3 text-[14px] text-muted">
            Staff get an invitation email from their institute.{" "}
            <Link href="/reset" className="text-brand hover:underline">
              Didn&apos;t get it?
            </Link>
          </p>
        </div>
      )}
    </AuthShell>
  );
}
