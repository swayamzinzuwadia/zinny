"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { LICENSABLE_MODULES, PLAN_DEFAULTS, PLAN_LABELS, PLANS, type Plan } from "../lib/constants";

export type LicenceValues = {
  plan: Plan;
  studentCap: number;
  staffCap: number;
  modules: string[];
  startDate: string;
  endDate: string;
  notes: string;
};

function endFor(start: string, months: number) {
  const [y, m, d] = start.split("-").map(Number);
  if (!y || !m || !d) return "";
  const end = new Date(Date.UTC(y, m - 1 + months, d));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

/**
 * The licence fields: plan, caps, modules and term. Picking a plan fills in its usual
 * caps and term until you change those yourself; every value can still be edited.
 */
export function LicenceFields({ initial, disabled }: { initial: LicenceValues; disabled?: boolean }) {
  const [plan, setPlan] = useState<Plan>(initial.plan);
  const [studentCap, setStudentCap] = useState(String(initial.studentCap));
  const [staffCap, setStaffCap] = useState(String(initial.staffCap));
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [touched, setTouched] = useState({ caps: false, end: false });

  function pickPlan(p: Plan) {
    setPlan(p);
    const d = PLAN_DEFAULTS[p];
    if (!touched.caps) {
      setStudentCap(String(d.studentCap));
      setStaffCap(String(d.staffCap));
    }
    if (!touched.end && startDate) setEndDate(endFor(startDate, d.months));
  }

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <Field label="Plan">
        <Select name="plan" value={plan} onChange={(e) => pickPlan(e.target.value as Plan)} required>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Student cap" hint="People with an active student role">
          <Input
            name="studentCap"
            inputMode="numeric"
            value={studentCap}
            onChange={(e) => {
              setStudentCap(e.target.value);
              setTouched((t) => ({ ...t, caps: true }));
            }}
            required
          />
        </Field>
        <Field label="Staff cap" hint="Admin and teaching roles">
          <Input
            name="staffCap"
            inputMode="numeric"
            value={staffCap}
            onChange={(e) => {
              setStaffCap(e.target.value);
              setTouched((t) => ({ ...t, caps: true }));
            }}
            required
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts on">
          <Input
            name="startDate"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (!touched.end && e.target.value) setEndDate(endFor(e.target.value, PLAN_DEFAULTS[plan].months));
            }}
            required
          />
        </Field>
        <Field label="Ends on">
          <Input
            name="endDate"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => {
              setEndDate(e.target.value);
              setTouched((t) => ({ ...t, end: true }));
            }}
            required
          />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium">Modules switched on</span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {LICENSABLE_MODULES.map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded-xl px-2 py-1 text-[14px] hover:bg-canvas">
              <input type="checkbox" name="modules" value={m.id} defaultChecked={initial.modules.includes(m.id)} className="h-4 w-4 accent-[#0b5e4c]" />
              {m.label}
            </label>
          ))}
        </div>
      </div>
      <Field label="Notes" hint="Optional. What was agreed, discounts, who signed.">
        <Textarea name="notes" defaultValue={initial.notes} maxLength={2000} />
      </Field>
    </fieldset>
  );
}
