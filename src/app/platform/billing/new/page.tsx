import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { createInvoiceAction } from "@/modules/zinny-team-panel/actions";
import { BackLink, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { GST_RATES_BP } from "@/modules/zinny-team-panel/lib/constants";
import { invoiceDraft } from "@/modules/zinny-team-panel/services/billing";
import { universityOptions } from "@/modules/zinny-team-panel/services/universities";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ university?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.finance")) return <NoAccess section="Zinny billing" who="Super Admins and Finance Admins" />;
  const { university } = await searchParams;
  const [unis, d] = await Promise.all([universityOptions(actor), invoiceDraft(actor, university)]);

  return (
    <>
      <BackLink href="/platform/billing">Zinny invoices</BackLink>
      <PageHeader
        title="New invoice"
        subtitle="Pick the university first to fill in its licence term. GST is split into CGST and SGST in Zinny's own state, IGST elsewhere. The number is given when you issue it."
      />
      <Card className="max-w-2xl">
        <form className="mb-5 flex items-end gap-2 border-b border-line pb-5">
          <Field label="University">
            <Select name="university" defaultValue={d.universityId} className="w-80">
              <option value="">Pick a university</option>
              {unis.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <button className="h-10 rounded-full border border-line px-4 text-[14px] font-medium hover:border-brand/40">Fill in from licence</button>
        </form>
        <ActionForm key={d.universityId} action={createInvoiceAction} resetOnSuccess={false} className="space-y-4">
          <input type="hidden" name="universityId" value={d.universityId} />
          {!d.universityId && <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">Pick the university above before you issue the invoice.</p>}
          <Field label="Description">
            <Input name="description" defaultValue={d.description} required maxLength={300} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period from">
              <Input name="periodStart" type="date" defaultValue={d.periodStart} required />
            </Field>
            <Field label="Period to">
              <Input name="periodEnd" type="date" defaultValue={d.periodEnd} required />
            </Field>
            <Field label="Amount before GST (₹)">
              <Input name="amount" inputMode="decimal" placeholder="45000" required />
            </Field>
            <Field label="GST">
              <Select name="gst" defaultValue={String(d.gstRateBp / 100)}>
                {GST_RATES_BP.map((g) => (
                  <option key={g} value={g / 100}>
                    {g / 100}%
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issue date">
              <Input name="issueDate" type="date" defaultValue={d.issueDate} required />
            </Field>
            <Field label="Due date">
              <Input name="dueDate" type="date" defaultValue={d.dueDate} required />
            </Field>
          </div>
          <SubmitButton pendingText="Issuing…">Issue invoice</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
