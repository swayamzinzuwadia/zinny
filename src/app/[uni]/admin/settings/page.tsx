import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { menuFor } from "@/server/authz/menu";
import { spaceContext } from "@/server/context";
import { canAdmit, getJoinSettings } from "@/modules/identity/joining";
import { setThresholdAction } from "@/modules/live-classes/actions";
import { attendanceThreshold, canSetThreshold } from "@/modules/live-classes/staff";

export const metadata = { title: "Settings" };

/** Where every institute-wide setting lives. Each card opens the page that holds it; the attendance threshold is set right here. */
export default async function SettingsHub({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const menu = menuFor(actor, university.id);
  if (!menu.some((s) => s.key === "settings")) notFound();

  const open = new Set(menu.flatMap((s) => s.items.map((i) => i.href)));
  const showThreshold = canSetThreshold(actor);
  const [threshold, joining] = await Promise.all([
    showThreshold ? attendanceThreshold(actor) : Promise.resolve(null),
    canAdmit(actor) ? getJoinSettings(actor) : Promise.resolve(null),
  ]);

  const base = `/${uni}/admin`;
  const cards: { href: string; opens: string; title: string; line: string; now?: string }[] = [
    {
      href: "/settings/notifications",
      opens: "/settings/notifications",
      title: "Notifications",
      line: "What reaches people by email, SMS and WhatsApp, the wording of each message, and the reply-to address.",
    },
    {
      href: "/users/requests",
      opens: "/users/requests",
      title: "Joining code",
      line: "The code and link students use to join, and whether someone accepts them first.",
      now: joining ? `Code ${joining.code}. ${joining.mode === "approval" ? "An Admin or HOD accepts each student." : "Students get in straight away."}` : undefined,
    },
    {
      href: "/users/invites",
      opens: "/users/invites",
      title: "Sign-in options",
      line: "Signing in with a mobile number, and whether students can create their own account.",
    },
    {
      href: "/leaderboards",
      opens: "/leaderboards",
      title: "Leaderboard names",
      line: "Whether students see each other's full names or first name and initial.",
    },
    {
      href: "/finance/sales/settings",
      opens: "/finance/sales",
      title: "Invoice settings",
      line: "The SAC code and footer on every GST invoice. Seller details are kept by the Zinny team.",
    },
    {
      href: "/website/profile",
      opens: "/website/profile",
      title: "Institute profile",
      line: "Your logo, colour, contact details and the About text on your website.",
    },
    {
      href: "/users/roles",
      opens: "/users/roles",
      title: "Roles & permissions",
      line: "What each role can do, and roles of your own.",
    },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Institute-wide settings, each kept next to the work it affects. Open one to change it." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-3 sm:grid-cols-2">
          {cards
            .filter((c) => open.has(c.opens))
            .map((c) => (
              <Link key={c.href} href={`${base}${c.href}`} className="group rounded-[22px] border border-line bg-surface px-5 py-4 transition-colors hover:border-brand/40">
                <div className="text-[16px] font-medium group-hover:text-brand">{c.title}</div>
                <p className="mt-1 text-[14px] text-muted">{c.line}</p>
                {c.now && <p className="mt-2 text-[13px] text-ink">{c.now}</p>}
              </Link>
            ))}
        </div>
        {threshold !== null && (
          <Card className="h-fit">
            <CardTitle>Attendance threshold</CardTitle>
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
      </div>
    </>
  );
}
