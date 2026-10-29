import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { demoEnabled } from "@/server/auth/config";
import { currentUserId } from "@/server/auth/session";
import { DEMO_ACCOUNTS, loginUniversity, phoneSignInView, safeNext } from "@/modules/identity/auth";
import { AuthShell, AuthTabs } from "@/modules/identity/components/auth-shell";
import { PasswordSignInForm, PhoneChooseForm, PhoneCodeForm, PhoneNumberForm } from "@/modules/identity/components/auth-forms";
import {
  UNI_COOKIE,
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
  // ?uni= (empty) means "not your institute": ignore the remembered one.
  const university = await loginUniversity({ uni: sp.uni ?? jar.get(UNI_COOKIE)?.value ?? null, next: sp.next });
  const phoneOn = !!university?.phoneSignIn;
  const tab = phoneOn && sp.tab === "phone" ? "phone" : "email";
  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(university ? { uni: university.slug } : {}), ...(next !== "/" ? { next } : {}), ...extra });
    const s = q.toString();
    return `/login${s ? `?${s}` : ""}`;
  };
  const phone = tab === "phone" ? await phoneSignInView(jar.get("zinny_phone_signin")?.value) : null;

  const title = phone?.step === "code" ? "Enter your code" : phone?.step === "choose" ? "Choose your account" : "Sign in to your institute";
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
    "Use the email your institute registered for you."
  );

  return (
    <AuthShell
      title={title}
      subtitle={phone ? undefined : subtitle}
      footer={
        demoEnabled() && !phone ? (
          <div className="rounded-[22px] border border-line bg-surface p-5">
            <h2 className="font-medium">Try a demo account</h2>
            <p className="mb-3 text-[13px] text-muted">Each one shows Zinny as that role sees it. Password for all: zinny123</p>
            <div className="grid gap-1">
              {DEMO_ACCOUNTS.map(([group, email, label]) => (
                <form key={email} action={demoSignInAction}>
                  <input type="hidden" name="email" value={email} />
                  <button className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[14px] hover:bg-canvas">
                    <span>{label}</span>
                    <span className="text-[12px] text-faint">{group}</span>
                  </button>
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
        <p className="mt-6 text-[14px] text-muted">
          New here? Your institute sends you an invitation email.{" "}
          <Link href="/reset" className="text-brand hover:underline">
            Didn&apos;t get it?
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
