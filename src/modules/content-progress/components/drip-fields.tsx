"use client";

/** When a lesson opens: straight away, N days after the student's batch starts, or on a date. */
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import type { DripMode } from "../lib/kinds";

export function DripFields({ mode, days, date, disabled }: { mode: DripMode; days: number | null; date: string | null; disabled?: boolean }) {
  const [m, setM] = useState<DripMode>(mode);
  return (
    <div className="space-y-3">
      <Field label="Opens for students">
        <Select name="dripMode" value={m} onChange={(e) => setM(e.target.value as DripMode)} disabled={disabled}>
          <option value="none">As soon as they enrol</option>
          <option value="after_start">Some days after their batch starts</option>
          <option value="on_date">On a fixed date</option>
        </Select>
      </Field>
      {m === "after_start" && (
        <Field label="Days after the batch starts" hint="0 opens it on the batch's first day.">
          <Input name="dripDays" type="number" min={0} max={730} step={1} inputMode="numeric" required defaultValue={days ?? 7} disabled={disabled} />
        </Field>
      )}
      {m === "on_date" && (
        <Field label="Opening date" hint="In the university's time zone. It opens at the start of that day.">
          <Input name="dripDate" type="date" required defaultValue={date ?? ""} disabled={disabled} />
        </Field>
      )}
    </div>
  );
}
