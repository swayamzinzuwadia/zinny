import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { can } from "@/server/authz/engine";
import { menuFor } from "@/server/authz/menu";
import { spaceContext } from "@/server/context";
import { setNameDisplayAction } from "@/modules/gamification/actions";
import { getNameDisplay, NAME_DISPLAYS } from "@/modules/gamification/settings";
import { canAdmit, getJoinSettings } from "@/modules/identity/joining";
import { getSignInSettings } from "@/modules/identity/settings";
import { setThresholdAction } from "@/modules/live-classes/actions";
import { attendanceThreshold, canSetThreshold } from "@/modules/live-classes/staff";
import { phoneSignInAction, selfSignupAction } from "../users/invites/actions";
import { joinModeAction, newJoinCodeAction } from "../users/requests/actions";

export const metadata = { title: "Settings" };

/**
 * The institute's settings, changed right here: how students join, how people sign in, the
 * attendance threshold and how names show on leaderboards. They used to sit on four different
 * pages, with this page only linking to them. The settings that are a whole page of their own
 * (the institute profile, invoices, roles, notifications) are listed below with what they hold.
 */
export default async function SettingsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const menu = menuFor(actor, university.id);
  if (!menu.some((s) => s.key === "settings")) notFound();

  const open = new Set(menu.flatMap((s) => s.items.map((i) => i.href)));
  const isAdmin = can(actor, "settings.manage", { universityId: university.id });
  const showThreshold = canSetThreshold(actor);
  const [threshold, joining, signIn, names] = await Promise.all([
    showThreshold ? attendanceThreshold(actor) : Promise.resolve(null),
    isAdmin && canAdmit(actor) ? getJoinSettings(actor) : Promise.resolve(null),
    isAdmin ? getSignInSettings(actor) : Promise.resolve(null),
    can(actor, "leaderboard.manage", { universityId: university.id }) ? getNameDisplay(actor) : Promise.resolve(null),
  ]);

  const base = `/${uni}/admin`;
  const more: { href: string; opens: string; title: string; line: string }[] = [
    { href: "/website/profile", opens: "/website/profile", title: "Institute profile", line: "Your logo, colour, contact details and the About text on your website." },
    { href: "/finance/sales/settings", opens: "/finance/sales", title: "Invoices and GST", line: "Whether you charge GST, and the SAC code and footer on every invoice." },
    { href: "/users/roles", opens: "/users/roles", title: "Roles & permissions", line: "What each role can do, and roles of your own." },
    { href: "/settings/notifications", opens: "/settings/notifications", title: "Notifications", line: "What reaches people by email, SMS and WhatsApp, and the wording of each message." },
  ].filter((c) => open.has(c.opens));

  return (
    <>
      <PageHeader title="Settings" subtitle="How your institute works on Zinny. Each change applies as soon as you save it." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {joining && (
          <Card className="text-[14px]">
            <CardTitle hint={<Link href={`${base}/users/requests`} className="hover:text-brand">Share the code</Link>}>Joining</CardTitle>
            <p className="text-muted">
              Students join with the code <span className="tabular font-medium tracking-[0.12em] text-ink">{joining.code}</span>.
            </p>
            <ActionForm action={joinModeAction} className="mt-4 space-y-2" resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[13px] font-medium">When a student uses the code</legend>
                {(
                  [
                    ["approval", "Ask Admins or HODs to accept them"],
                    ["instant", "Let them in straight away"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2.5">
                    <input type="radio" name="mode" value={value} defaultChecked={joining.mode === value} className="accent-brand" />
                    {label}
                  </label>
                ))}
              </fieldset>
              <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                Save joining rule
              </SubmitButton>
            </ActionForm>
            <ActionForm action={newJoinCodeAction} className="mt-4 border-t border-line pt-4" confirm="The old code will stop working. Make a new one?">
              <input type="hidden" name="uni" value={uni} />
              <SubmitButton size="sm" variant="ghost" pendingText="Making a new code…">
                Make a new code
              </SubmitButton>
            </ActionForm>
          </Card>
        )}

        {signIn && (
          <Card>
            <CardTitle>Sign-in</CardTitle>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Sign in with a mobile number</div>
                <p className="mt-1 text-[13px] text-muted">Adds a Mobile number tab to the sign-in page. People get a 6-digit code by SMS to the number on their profile.</p>
              </div>
              <Badge tone={signIn.phoneSignIn ? "brand" : "neutral"}>{signIn.phoneSignIn ? "On" : "Off"}</Badge>
            </div>
            <ActionForm action={phoneSignInAction} className="mt-4" resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="on" value={signIn.phoneSignIn ? "0" : "1"} />
              <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                {signIn.phoneSignIn ? "Turn off phone sign-in" : "Turn on phone sign-in"}
              </SubmitButton>
            </ActionForm>
            <div className="mt-6 flex items-start justify-between gap-3 border-t border-line pt-5">
              <div>
                <div className="font-medium">Student sign-up</div>
                <p className="mt-1 text-[13px] text-muted">
                  Lets students create their own account at <span className="break-all text-ink">/signup?uni={uni}</span>. Turn it off if you only want students you add yourself.
                </p>
              </div>
              <Badge tone={signIn.selfSignup ? "brand" : "neutral"}>{signIn.selfSignup ? "On" : "Off"}</Badge>
            </div>
            <ActionForm action={selfSignupAction} className="mt-4" resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="on" value={signIn.selfSignup ? "0" : "1"} />
              <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                {signIn.selfSignup ? "Turn off student sign-up" : "Turn on student sign-up"}
              </SubmitButton>
            </ActionForm>
          </Card>
        )}

        {threshold !== null && (
          <Card>
            <CardTitle>Attendance</CardTitle>
            <ActionForm action={setThresholdAction} resetOnSuccess={false} className="space-y-3">
              <input type="hidden" name="uni" value={uni} />
              <Field label="Minimum attendance" hint="For every batch. Students below it are highlighted and alerted each week, with a summary for their HOD.">
                <div className="flex items-center gap-2">
                  <Input name="threshold" type="number" min={1} max={100} step={1} defaultValue={threshold} className="w-24" required />
                  <span className="text-muted">%</span>
                </div>
              </Field>
              <SubmitButton variant="secondary">Save threshold</SubmitButton>
            </ActionForm>
          </Card>
        )}

        {names && (
          <Card>
            <CardTitle>Names on leaderboards</CardTitle>
            <p className="mb-4 text-[14px] text-muted">How students see each other on leaderboards. Staff always see full names.</p>
            <ActionForm action={setNameDisplayAction} resetOnSuccess={false} className="space-y-3">
              <input type="hidden" name="uni" value={uni} />
              {NAME_DISPLAYS.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line px-4 py-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" name="nameDisplay" value={o.key} defaultChecked={names === o.key} className="accent-[var(--color-brand)]" />
                  <span className="min-w-0 flex-1 text-[14px] font-medium">{o.label}</span>
                  <span className="text-[13px] text-muted">{o.example}</span>
                </label>
              ))}
              <SubmitButton variant="secondary">Save name setting</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      {more.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-[16px] font-medium">More settings</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {more.map((c) => (
              <Link key={c.href} href={`${base}${c.href}`} className="group rounded-[22px] border border-line bg-surface px-5 py-4 transition-colors hover:border-brand/40">
                <div className="text-[16px] font-medium group-hover:text-brand">{c.title}</div>
                <p className="mt-1 text-[14px] text-muted">{c.line}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
