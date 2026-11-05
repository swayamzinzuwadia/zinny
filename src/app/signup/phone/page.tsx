import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { universityBySlug } from "@/server/context";
import { ForbiddenError } from "@/server/errors";
import { safeNext } from "@/modules/identity/auth";
import { signUpPhoneActor, signUpPhoneStatus } from "@/modules/identity/profile";
import { AuthShell } from "@/modules/identity/components/auth-shell";
import { PhoneChange } from "@/modules/identity/components/profile-forms";
import {
  cancelSignUpPhoneAction,
  noRemoveAction,
  resendSignUpPhoneAction,
  startSignUpPhoneAction,
  verifySignUpPhoneAction,
} from "./actions";

export const metadata = { title: "Confirm your mobile number" };

/**
 * Right after an institute sign-up that gave a mobile number: enter the texted code, or
 * skip. The number is saved only once its code is right.
 */
export default async function SignUpPhonePage({ searchParams }: { searchParams: Promise<{ uni?: string; next?: string; failed?: string }> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const next = safeNext(sp.next) ?? "/";
  const university = sp.uni ? await universityBySlug(sp.uni) : null;
  if (!university) notFound();

  let actor;
  try {
    actor = await signUpPhoneActor(userId, university.id);
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
    actor = null;
  }
  if (!actor) redirect(next);
  const { phone, pending } = await signUpPhoneStatus(actor, userId);
  if (phone && !pending) redirect(next);

  return (
    <AuthShell title="Confirm your mobile number" subtitle={`So ${university.name} can reach you. It only takes the code we text you.`}>
      {sp.failed && !pending && (
        <div className="mb-5">
          <Notice tone="gold">We couldn&apos;t send a code to that number. Check it and try again, or skip this for now.</Notice>
        </div>
      )}
      <PhoneChange
        uni={university.slug}
        current={null}
        pending={
          pending
            ? { masked: pending.masked, resendAt: pending.resendAt.getTime(), expiresAt: pending.expiresAt.getTime(), attemptsLeft: pending.attemptsLeft }
            : null
        }
        fields={{ next }}
        start={startSignUpPhoneAction}
        verify={verifySignUpPhoneAction}
        resend={resendSignUpPhoneAction}
        cancel={cancelSignUpPhoneAction}
        remove={noRemoveAction}
      />
      <p className="mt-8 text-[14px] text-muted">
        <Link href={next} className="font-medium text-brand hover:underline">
          Skip for now
        </Link>
        . You can add your number later from your profile.
      </p>
    </AuthShell>
  );
}
