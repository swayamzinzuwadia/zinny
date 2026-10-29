import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Badge, Card, CardTitle, Empty, Field, Input, Notice, cx } from "@/components/ui";
import { can, isActive } from "@/server/authz/engine";
import { ROLE_LABELS } from "@/server/authz/roles";
import { spaceContext } from "@/server/context";
import { currentSession } from "@/server/auth/session";
import { METHOD_LABEL, describeDevice } from "@/server/auth/device";
import { formatPhone } from "@/server/auth/phone";
import { getProfile, mySessions } from "@/modules/identity/profile";
import { PasswordField } from "@/modules/identity/components/auth-forms";
import { ConfirmButton, ConfirmForm, PhoneChange, PhotoForm } from "@/modules/identity/components/profile-forms";
import {
  cancelPhoneChangeAction,
  changePasswordAction,
  removePhoneAction,
  removePhotoAction,
  resendPhoneChangeAction,
  signOutEverywhereAction,
  signOutSessionAction,
  startPhoneChangeAction,
  updateNameAction,
  uploadPhotoAction,
  verifyPhoneChangeAction,
} from "./actions";

export const metadata = { title: "Your profile" };

function ago(d: Date, now: Date) {
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (mins < 2) return "Active now";
  if (mins < 60) return `Active ${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `Active ${h} h ago`;
  const days = Math.round(h / 24);
  return `Active ${days} day${days === 1 ? "" : "s"} ago`;
}

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(d);

export default async function ProfilePage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);

  if (!can(actor, "self.profile", { universityId: university.id, ownerUserId: actor.userId })) {
    return (
      <Empty title="You don't have a profile at this institute">
        Your role here has ended or hasn&apos;t started yet. <Link href="/" className="text-brand hover:underline">Choose another space</Link>.
      </Empty>
    );
  }

  const now = new Date();
  const [profile, sessions, current] = await Promise.all([getProfile(actor, actor.userId, now), mySessions(actor, actor.userId), currentSession()]);
  const roles = [...new Set(actor.assignments.filter((a) => isActive(a, now) && a.universityId === university.id).map((a) => ROLE_LABELS[a.role]))];
  const others = sessions.filter((s) => s.id !== current?.sessionId);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-4">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photoUrl} alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-full object-cover ring-2 ring-surface" />
        ) : (
          <Avatar name={profile.name} size={72} />
        )}
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight">{profile.name}</h1>
          <p className="truncate text-[15px] text-muted">{roles.join(", ") || "Member"} at {university.name}</p>
        </div>
      </section>

      <Card>
        <CardTitle>Your details</CardTitle>
        <div className="space-y-6">
          <ActionForm action={updateNameAction} resetOnSuccess={false} className="max-w-md">
            <input type="hidden" name="uni" value={uni} />
            <Field label="Name" hint="As you'd like it shown to your institute and on certificates.">
              <Input name="name" defaultValue={profile.name} autoComplete="name" required minLength={2} maxLength={80} />
            </Field>
            <div className="mt-3">
              <SubmitButton size="sm" pendingText="Saving…">
                Save name
              </SubmitButton>
            </div>
          </ActionForm>

          <div className="border-t border-line pt-5">
            <div className="mb-1.5 text-[13px] font-medium">Email</div>
            <div className="break-all text-[15px]">{profile.email}</div>
            <p className="mt-1 text-[12px] text-muted">You sign in with this. To change it, ask your institute&apos;s admin.</p>
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-2 text-[13px] font-medium">Mobile number</div>
            <PhoneChange
              uni={uni}
              current={profile.phone ? formatPhone(profile.phone) : null}
              pending={
                profile.pendingPhone
                  ? {
                      masked: profile.pendingPhone.masked,
                      resendAt: profile.pendingPhone.resendAt.getTime(),
                      expiresAt: profile.pendingPhone.expiresAt.getTime(),
                      attemptsLeft: profile.pendingPhone.attemptsLeft,
                    }
                  : null
              }
              start={startPhoneChangeAction}
              verify={verifyPhoneChangeAction}
              resend={resendPhoneChangeAction}
              cancel={cancelPhoneChangeAction}
              remove={removePhoneAction}
            />
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-2 text-[13px] font-medium">Photo</div>
            <PhotoForm uni={uni} upload={uploadPhotoAction} remove={removePhotoAction} hasPhoto={!!profile.photoUrl} />
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Password</CardTitle>
        {profile.hasPassword ? (
          <ActionForm action={changePasswordAction} className="max-w-md space-y-4">
            <input type="hidden" name="uni" value={uni} />
            <input type="text" name="username" value={profile.email} autoComplete="username" readOnly hidden />
            <PasswordField name="current" label="Current password" autoComplete="current-password" />
            <PasswordField name="password" label="New password" autoComplete="new-password" hint="At least 8 characters. A short sentence works well." />
            <PasswordField name="confirm" label="Type the new password again" autoComplete="new-password" />
            <p className="text-[13px] text-muted">Changing your password signs you out on every other device.</p>
            <SubmitButton pendingText="Changing password…">Change password</SubmitButton>
          </ActionForm>
        ) : (
          <Notice tone="gold">
            You haven&apos;t set a password yet, so you sign in with a code to your phone.{" "}
            <Link href={`/reset?email=${encodeURIComponent(profile.email)}`} className="font-medium underline underline-offset-2">
              Set a password by email
            </Link>
          </Notice>
        )}
      </Card>

      <Card>
        <CardTitle hint={`${sessions.length} signed in`}>Where you&apos;re signed in</CardTitle>
        <ul className="divide-y divide-line">
          {sessions.map((s) => {
            const mine = s.id === current?.sessionId;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{describeDevice(s.userAgent)}</span>
                    {mine && <Badge tone="gold">This device</Badge>}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    <span className={cx(mine && "text-ink")}>{mine ? "Active now" : ago(s.lastSeenAt, now)}</span>
                    {" · "}
                    {METHOD_LABEL[s.method] ?? "Password"}, {when(s.createdAt)}
                    {s.ip && <span className="tabular"> · {s.ip}</span>}
                  </div>
                </div>
                {!mine && (
                  <ConfirmButton
                    action={signOutSessionAction}
                    fields={{ uni, sessionId: s.id }}
                    confirm={`Sign out ${describeDevice(s.userAgent)}? It will need to sign in again.`}
                    pendingText="Signing out…"
                  >
                    Sign out
                  </ConfirmButton>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="max-w-md text-[13px] text-muted">
            {others.length > 0
              ? "Don't recognise a device? Sign it out, then change your password."
              : "You're only signed in here."}
          </p>
          <ConfirmForm action={signOutEverywhereAction} fields={{ uni }} confirm="Sign out on every device, this one included? You'll need to sign in again.">
            <SubmitButton variant="danger" pendingText="Signing out…">
              Sign out everywhere
            </SubmitButton>
          </ConfirmForm>
        </div>
      </Card>
    </div>
  );
}
