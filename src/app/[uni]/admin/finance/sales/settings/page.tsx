import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { can } from "@/server/core";
import { saveInvoiceSettingsAction } from "@/modules/payments/actions";
import { saveGstSettingAction } from "@/modules/payments/invoice-actions";
import { FOOTER_MAX, getInvoiceSettings } from "@/modules/payments/settings";

export const metadata = { title: "Invoice settings" };
export const dynamic = "force-dynamic";

export default async function InvoiceSettingsPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "finance.view", { universityId: university.id })) {
    return (
      <>
        <PageHeader title="Invoice settings" />
        <Empty title="You don't have access to invoice settings">Your role doesn&apos;t include them. Ask an Institute Admin if you need them.</Empty>
      </>
    );
  }
  const s = await getInvoiceSettings(actor);

  return (
    <>
      <PageHeader title="Invoice settings" subtitle="Whether you charge GST, and what every invoice of this institute shows. Invoices already issued keep what they were issued with." />

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-medium">Charge GST on fees</h2>
          <Badge tone={s.gstEnabled ? "brand" : "neutral"}>{s.gstEnabled ? "GST is on" : "GST is off"}</Badge>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 text-[14px]">
            <p>
              {s.gstEnabled
                ? "GST is added to every fee at the rate set on the course or invoice, and each payment gets a tax invoice with your GSTIN, SAC code and CGST, SGST or IGST."
                : "Fees are charged as they are, with no GST. Each payment gets a plain invoice: no GSTIN, SAC code or tax rows."}
            </p>
            <ul className="space-y-1.5 text-muted">
              <li>
                <span className="font-medium text-ink">On:</span> prices show “+ GST”, checkout adds it, invoices are titled “Tax invoice”.
              </li>
              <li>
                <span className="font-medium text-ink">Off:</span> the price is the total, invoices are titled “Invoice”, and the GST rate on courses and categories is kept but not used.
              </li>
              <li>Orders and invoices that already exist never change. Turning GST back on only affects new ones.</li>
            </ul>
            <p className="text-[13px] text-muted">Turn GST off only if your institute isn&apos;t registered for GST or its fees are exempt. Check with your chartered accountant.</p>
          </div>
          {s.canEdit ? (
            <ActionForm action={saveGstSettingAction} className="space-y-3" resetOnSuccess={false}>
              <input type="hidden" name="uni" value={uni} />
              <fieldset className="space-y-2">
                <legend className="sr-only">Charge GST on fees</legend>
                {(
                  [
                    ["on", "Charge GST", "Add GST to new orders and invoices."],
                    ["off", "Don't charge GST", "New orders and invoices carry no tax."],
                  ] as const
                ).map(([value, label, line]) => (
                  <label
                    key={value}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft",
                      "border-line bg-surface hover:border-brand/40",
                    )}
                  >
                    <input type="radio" name="gstEnabled" value={value} defaultChecked={(value === "on") === s.gstEnabled} className="mt-1 accent-[var(--color-brand)]" />
                    <span>
                      <span className="block text-[14px] font-medium">{label}</span>
                      <span className="block text-[13px] text-muted">{line}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton pendingText="Saving…">Save GST setting</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-[13px] text-muted">Only Accounts &amp; Fees and Institute Admins can change this.</p>
          )}
        </div>
      </Card>

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
                {!s.gstEnabled && <dd className="text-[12px] text-muted">Not printed while GST is off</dd>}
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
              {!s.gstEnabled && "GST is off, so the SAC code isn't printed for now; the footer still is. "}
              Confirm the SAC code with your chartered accountant. 999293 covers commercial training and coaching; degree programmes from a recognised institute may use
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
