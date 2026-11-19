/**
 * Pack size and year price, for students and for staff: the defaults in billing settings, or
 * one plan's own (where an empty field means "use the default"). Read only without
 * platform.seat_pricing.
 */
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { formatINR } from "../lib/format";
import type { PackDefaults } from "../lib/seat-packs";

type Values = { [K in keyof PackDefaults]: number | null };

export function PackTermsForm({
  action,
  values,
  defaults,
  canEdit,
  hidden = {},
  submitLabel,
}: {
  action: FormAction;
  values: Values;
  /** Set for a plan: shown as placeholders, and empty fields fall back to them. */
  defaults?: PackDefaults;
  canEdit: boolean;
  hidden?: Record<string, string>;
  submitLabel: string;
}) {
  const rupees = (p: number | null) => (p === null ? "" : String(p / 100));
  const rows = [
    { who: "Students", size: "studentPackSize", price: "studentPackPrice", sizeV: values.studentPackSize, priceV: values.studentPackPricePaise, dSize: defaults?.studentPackSize, dPrice: defaults?.studentPackPricePaise },
    { who: "Staff", size: "staffPackSize", price: "staffPackPrice", sizeV: values.staffPackSize, priceV: values.staffPackPricePaise, dSize: defaults?.staffPackSize, dPrice: defaults?.staffPackPricePaise },
  ];
  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {rows.map((r) => (
        <fieldset key={r.who} className="grid gap-4 sm:grid-cols-2" disabled={!canEdit}>
          <Field label={`${r.who} per pack`} hint={r.dSize !== undefined ? `Empty: ${r.dSize}, the default` : undefined}>
            <Input name={r.size} inputMode="numeric" defaultValue={r.sizeV ?? ""} placeholder={r.dSize !== undefined ? String(r.dSize) : undefined} required={!defaults} />
          </Field>
          <Field label={`${r.who} pack, a year before GST (₹)`} hint={r.dPrice !== undefined ? `Empty: ${formatINR(r.dPrice)}, the default` : "A mid-term pack pays for the days left"}>
            <Input name={r.price} inputMode="decimal" defaultValue={rupees(r.priceV)} placeholder={r.dPrice !== undefined ? String(r.dPrice / 100) : undefined} required={!defaults} />
          </Field>
        </fieldset>
      ))}
      {canEdit ? (
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
      ) : (
        <p className="text-[13px] text-muted">Changing pack sizes and prices needs the Edit seat packs and user caps permission.</p>
      )}
    </ActionForm>
  );
}
