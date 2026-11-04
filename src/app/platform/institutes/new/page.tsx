import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { createUniversityAction } from "@/modules/zinny-team-panel/actions";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { OptionalLicence } from "@/modules/zinny-team-panel/components/optional-licence";
import { LICENSABLE_MODULES, PLAN_DEFAULTS } from "@/modules/zinny-team-panel/lib/constants";
import { addDays, addMonths, todayIST } from "@/modules/zinny-team-panel/lib/format";

export const metadata = { title: "New institute" };

export default async function NewUniversityPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.manage_universities")) return <NoAccess section="Institutes" />;
  const canLicence = canPlatform(actor, "platform.licences");
  const today = todayIST();
  const d = PLAN_DEFAULTS.pilot;

  return (
    <>
      <PageHeader
        title="New institute"
        subtitle="Creates its private space and invites its Institute Admin by email. Nothing is visible to students until the admin sets it up."
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
              <Field label="Invoice prefix" hint="1 to 4 letters or numbers on its student invoices. Leave empty to use the web address.">
                <Input name="invoicePrefix" placeholder="LCA" maxLength={4} className="uppercase" />
              </Field>
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
              </div>
            </div>
          </Card>
          <Card className="h-fit">
            <CardTitle>Licence</CardTitle>
            {canLicence ? (
              <OptionalLicence
                initial={{
                  plan: "pilot",
                  studentCap: d.studentCap,
                  staffCap: d.staffCap,
                  modules: LICENSABLE_MODULES.map((m) => m.id),
                  startDate: today,
                  endDate: addDays(addMonths(today, d.months), -1),
                  notes: "",
                }}
              />
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
