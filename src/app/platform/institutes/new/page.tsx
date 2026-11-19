import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { createUniversityAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { OptionalLicence } from "@/modules/zinny-team-panel/components/optional-licence";
import { isSuperAdmin } from "@/modules/zinny-team-panel/lib/access";
import { zinnySeller } from "@/modules/zinny-team-panel/lib/constants";
import { licenceFormSettings } from "@/modules/zinny-team-panel/services/billing-settings";
import { todayIST } from "@/modules/zinny-team-panel/lib/format";
import { licenceDefaults } from "@/modules/zinny-team-panel/lib/licence";
import { planOptions } from "@/modules/zinny-team-panel/services/plans";
import { PASSWORD_MIN } from "@/server/auth/passwords";

export const metadata = { title: "New institute" };

export default async function NewUniversityPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.manage_universities")) return <NoAccess section="Institutes" />;
  const canLicence = canPlatform(actor, "platform.licences");
  const today = todayIST();
  const [plans, settings] = canLicence ? await Promise.all([planOptions(actor), licenceFormSettings(actor)]) : [[], null];
  // A new institute usually starts on the Pilot; without one, on the first plan on offer.
  const first = plans.find((p) => p.key === "pilot") ?? plans[0];
  const superAdmin = isSuperAdmin(actor);

  return (
    <>
      <PageHeader
        title="New institute"
        subtitle="Creates its private space and invites its Institute Admin by email. With a licence, it also invoices the plan. Students see nothing until the admin sets it up."
      />
      <ActionForm action={createUniversityAction} resetOnSuccess={false} className="max-w-5xl space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="h-fit">
            <CardTitle>The institute</CardTitle>
            <div className="space-y-4">
              <Field label="Name" hint="As students and staff know it.">
                <Input name="name" placeholder="Lakeview College of Arts" required minLength={2} maxLength={120} />
              </Field>
              <Field label="Web address" hint="zinny.app/your-address. Lowercase letters, numbers and hyphens.">
                <Input name="slug" placeholder="lakeview" required minLength={2} maxLength={40} autoCapitalize="none" spellCheck={false} />
              </Field>
              {/* Rarely changed, so it stays out of the way until asked for. */}
              <details className="group rounded-xl border border-line px-4 py-3 open:bg-canvas/50">
                <summary className="cursor-pointer list-none text-[14px] text-muted group-open:text-ink">Invoice prefix, optional</summary>
                <div className="mt-3">
                  <Field label="Invoice prefix" hint="1 to 4 letters or numbers on its student invoices. Left empty, the web address is used.">
                    <Input name="invoicePrefix" placeholder="LCA" maxLength={4} className="uppercase" />
                  </Field>
                </div>
              </details>
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-3 text-[15px] font-medium">Institute Admin</h3>
              <div className="space-y-4">
                <Field label="Name">
                  <Input name="adminName" placeholder="Full name" required minLength={2} />
                </Field>
                <Field label="Email" hint="They get an email to set their password.">
                  <Input name="adminEmail" type="email" placeholder="name@institute.edu" required />
                </Field>
                {superAdmin && (
                  <Field
                    label="Password"
                    hint={`Optional. Set it now and they can sign in straight away; pass it on safely, it isn't shown again. At least ${PASSWORD_MIN} characters. Left empty, they set their own from the invitation.`}
                  >
                    <Input name="adminPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} />
                  </Field>
                )}
              </div>
            </div>
          </Card>
          <Card className="h-fit">
            <CardTitle>Licence</CardTitle>
            {canLicence && first ? (
              <OptionalLicence
                plans={plans}
                initial={licenceDefaults(first, today)}
                // A new institute starts in Zinny's default state until its GST details are filled in.
                charge={{ invoiceDate: today, ...settings!, intraState: zinnySeller().stateCode === "27" }}
              />
            ) : canLicence ? (
              <p className="text-[14px] text-muted">Every plan is archived. Restore one on the Plans page, then set up the licence from Licences.</p>
            ) : (
              <p className="text-[14px] text-muted">A Super Admin, Account Manager or Finance Admin sets up the licence afterwards.</p>
            )}
          </Card>
        </div>
        <SubmitButton pendingText="Creating…">Create institute and invite admin</SubmitButton>
      </ActionForm>
    </>
  );
}
