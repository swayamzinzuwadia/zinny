import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { saveInvoiceSettingsAction } from "@/modules/payments/actions";
import { FOOTER_MAX, getInvoiceSettings } from "@/modules/payments/settings";

export const metadata = { title: "Invoice settings" };
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const back = (
    <div className="mb-2 text-sm text-muted">
      <Link href={`/${uni}/admin/finance/sales`} className="hover:text-ink">
        Sales
      </Link>{" "}
      / Invoice settings
    </div>
  );
  if (!can(actor, "finance.view", { universityId: university.id })) {
    return (
      <>
        {back}
        <PageHeader title="Invoice settings" />
        <Empty title="You don't have access to invoice settings">They&apos;re for Institute Admins, Board / Owner and Accounts &amp; Fees.</Empty>
      </>
    );
  }
  const s = await getInvoiceSettings(actor);

  return (
    <>
      {back}
      <PageHeader title="Invoice settings" subtitle="What every GST invoice of this university shows. Invoices already issued keep what they were issued with." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Seller details</CardTitle>
          {s.gaps.length > 0 && (
            <div className="mb-4">
              <Notice tone="gold">Invoices are missing {s.gaps.join(", ").replace(/, ([^,]*)$/, " and $1")}. Ask Zinny support to add them; a GST invoice needs them.</Notice>
            </div>
          )}
          <dl className="space-y-3 text-[14px]">
            <div>
              <dt className="text-[13px] text-muted">Legal name</dt>
              <dd>{s.seller.legalName ?? s.seller.name}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">Registered address</dt>
              <dd className="whitespace-pre-line">{s.seller.address ?? "Not set"}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[13px] text-muted">GSTIN</dt>
                <dd className="font-mono text-[13px]">{s.seller.gstin ?? "Not registered"}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">State</dt>
                <dd>{s.seller.state}</dd>
              </div>
            </div>
            <div>
              <dt className="text-[13px] text-muted">Invoice numbers</dt>
              <dd className="font-mono text-[13px]">{s.seller.invoicePrefix}/YY-YY/00001</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] text-muted">The Zinny team keeps these details. Write to Zinny support to change them.</p>
        </Card>

        <Card>
          <CardTitle>On every invoice</CardTitle>
          <div className="mb-4">
            <Notice tone="neutral">
              Confirm the SAC code with your chartered accountant. 999293 covers commercial training and coaching; degree programmes from a recognised university may use
              another code or be exempt from GST.
            </Notice>
          </div>
          {s.canEdit ? (
            <ActionForm action={saveInvoiceSettingsAction} className="space-y-4" resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <Field label="SAC code" hint="4 or 6 digits, starting with 99.">
                <Input name="sacCode" defaultValue={s.sacCode} inputMode="numeric" pattern="99[0-9]{2}([0-9]{2})?" required className="max-w-40 font-mono" />
              </Field>
              <Field label="Invoice footer" hint={`Refund policy, billing contact. Up to ${FOOTER_MAX} characters.`}>
                <Textarea name="invoiceFooter" defaultValue={s.invoiceFooter} maxLength={FOOTER_MAX} rows={4} />
              </Field>
              <SubmitButton>Save invoice settings</SubmitButton>
            </ActionForm>
          ) : (
            <dl className="space-y-3 text-[14px]">
              <div>
                <dt className="text-[13px] text-muted">SAC code</dt>
                <dd className="font-mono">{s.sacCode}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">Invoice footer</dt>
                <dd className="whitespace-pre-line">{s.invoiceFooter || "None"}</dd>
              </div>
              <p className="text-[13px] text-muted">Only Accounts &amp; Fees and Institute Admins can change these.</p>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
