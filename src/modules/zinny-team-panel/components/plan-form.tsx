import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { savePlanAction } from "../actions";
import { GST_RATES_BP, LICENSABLE_MODULES } from "../lib/constants";
import type { Plan } from "../services/plans";

const rupeeText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

/** Create a plan, or edit one. A plan's key is set once and never changes: licences store it. */
export function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <ActionForm action={savePlanAction} resetOnSuccess={false} className="space-y-4">
      {plan && <input type="hidden" name="planId" value={plan.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="As it appears on licences and invoices">
          <Input name="name" defaultValue={plan?.name} placeholder="Campus Plus" required minLength={2} maxLength={60} />
        </Field>
        {plan ? (
          <Field label="Key" hint="Set when the plan was created. It never changes.">
            <Input value={plan.key} readOnly disabled className="font-mono" />
          </Field>
        ) : (
          <Field label="Key" hint="Optional. Lowercase letters, numbers and hyphens. Left empty, it is made from the name.">
            <Input name="key" placeholder="campus-plus" maxLength={32} autoCapitalize="none" spellCheck={false} className="font-mono" />
          </Field>
        )}
      </div>
      <Field label="Description" hint="One line on who the plan is for">
        <Textarea name="description" defaultValue={plan?.description} maxLength={300} className="min-h-16" />
      </Field>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Field label="Price before GST (₹)" hint="For one billing period">
          <Input name="price" inputMode="decimal" defaultValue={plan ? rupeeText(plan.pricePaise) : ""} placeholder="720000" required />
        </Field>
        <Field label="Billing period (months)">
          <Input name="billingMonths" inputMode="numeric" defaultValue={plan?.billingMonths ?? 12} required />
        </Field>
        <Field label="GST">
          <Select name="gst" defaultValue={String((plan?.gstRateBp ?? 1800) / 100)}>
            {GST_RATES_BP.map((g) => (
              <option key={g} value={g / 100}>
                {g / 100}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Position in the list" hint="Lower comes first">
          <Input name="sortOrder" inputMode="numeric" defaultValue={plan?.sortOrder ?? 100} />
        </Field>
        <Field label="Student cap">
          <Input name="studentCap" inputMode="numeric" defaultValue={plan?.studentCap ?? 500} required />
        </Field>
        <Field label="Staff cap">
          <Input name="staffCap" inputMode="numeric" defaultValue={plan?.staffCap ?? 40} required />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium">Modules a new licence starts with</span>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {LICENSABLE_MODULES.map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded-xl px-2 py-1 text-[14px] hover:bg-canvas">
              <input type="checkbox" name="modules" value={m.id} defaultChecked={plan ? plan.modules.includes(m.id) : true} className="h-4 w-4 accent-[#0b5e4c]" />
              {m.label}
            </label>
          ))}
        </div>
      </div>
      <SubmitButton pendingText="Saving…">{plan ? "Save plan" : "Create plan"}</SubmitButton>
    </ActionForm>
  );
}
